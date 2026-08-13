// zustand 全局状态：CLI 列表、任务线程、设置、错误提示、流式事件装配
import { create } from 'zustand';
import { EventBatcher } from './utils/batcher';
import { assembleEvent, blocksText } from '../electron/shared';
import type { PermissionRequestPayload } from '../electron/shared';
import type {
  AppSettings,
  ChatMessage,
  CliInfo,
  CliId,
  ModelEntry,
  StreamEvent,
  Task,
} from '../electron/shared';

// 右侧栏标签页：预览和浏览器统一为标签，支持同时打开多个
export type RightTab =
  | { id: string; kind: 'preview'; path: string; cwd?: string; title: string }
  | { id: string; kind: 'browser'; url: string; title: string }
  | { id: string; kind: 'test'; title: string };

let tabSeq = 0;
const newTabId = () => `tab_${Date.now()}_${tabSeq++}`;

function fileTitle(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function urlTitle(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

let msgSeq = 0;
const localMsg = (role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage => ({
  id: `local_${Date.now()}_${msgSeq++}`,
  role,
  text,
  ts: Date.now(),
  ...extra,
});

interface HubState {
  clis: CliInfo[];
  tasks: Task[];
  activeTaskId: string | null;
  runningTaskIds: Set<string>;
  settings: AppSettings | null;
  settingsOpen: boolean;
  error: string | null;
  pendingPermissions: PermissionRequestPayload[];
  resolvedPermissions: Record<string, string>; // requestId → 已选 optionId
  previewPath: string | null;
  pendingInsert: string | null; // 浏览器选取元素等待插入输入框的文本 // 文件预览面板（兼容旧调用，由 rightTabs 派生）
  previewCwd?: string;        // 预览路径解析基准（任务目录）
  browserUrl: string;
  browserPanelOpen: boolean;
  // 多标签页：预览与浏览器合并为同一类标签，支持同时打开多个
  rightTabs: RightTab[];
  activeRightTabId: string | null;
  rightPanelOpen: boolean;
  // 左栏：哪个任务展开了文件树（同一时间只展开一个）
  expandedFileTaskId: string | null;
  // 统一模型列表缓存：供 ContextRing 查询当前任务的 contextWindow
  modelEntries: ModelEntry[];
  init: () => Promise<void>;
  refreshClis: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshModelEntries: () => Promise<void>;
  setActive: (id: string | null) => void;
  createTask: (cliId: CliId, cwd: string) => Promise<void>;
  removeTask: (taskId: string) => Promise<void>;
  send: (taskId: string, text: string, images?: Array<{ data: string; mimeType: string; name: string }>) => Promise<void>;
  stop: (taskId: string) => Promise<void>;
  applySettings: (partial: Partial<AppSettings>) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setError: (msg: string | null) => void;
  setPreviewPath: (path: string | null, cwd?: string) => void;
  setPendingInsert: (text: string | null) => void;
  respondPermission: (requestId: string, optionId: string | null) => Promise<void>;
  clearPermissionsFor: (taskId: string) => void;
  setBrowserUrl: (url: string) => void;
  setBrowserPanelOpen: (open: boolean) => void;
  closeRightTab: (id: string) => void;
  openTestTab: () => void;
  setActiveRightTab: (id: string) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  toggleTaskFiles: (taskId: string | null) => void;
  handleEvent: (ev: StreamEvent) => void;
  handleBatch: (events: StreamEvent[]) => void;
}

// 在任务的消息列表上应用一个流式事件（渲染进程本地装配，与主进程共用 assembleEvent）
function applyEvent(task: Task, ev: StreamEvent): Task {
  const messages = [...task.messages];
  const last = messages[messages.length - 1];

  if (ev.type === 'delta' || ev.type === 'thinking' || ev.type === 'tool_call' || ev.type === 'tool_result') {
    // 找到或新建流式 assistant 消息，事件按序进 blocks
    let msg = last?.role === 'assistant' && last.streaming ? last : null;
    if (!msg) {
      msg = localMsg('assistant', '', { streaming: true, blocks: [] });
      messages.push(msg);
    }
    const blocks = (msg.blocks ?? []).map((b) => ({ ...b }));
    assembleEvent(blocks, ev);
    messages[messages.length - 1] = { ...msg, blocks, text: blocksText(blocks) };
  } else if (ev.type === 'error') {
    if (last?.role === 'assistant' && last.streaming) {
      messages[messages.length - 1] = { ...last, streaming: false };
    }
    // 从最后一条 user 消息恢复 retryText，确保重试按钮可用（即使 refreshTasks 时序异常也能重试）
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    messages.push(localMsg('system', ev.message, { error: true, retryText: lastUserMsg?.text }));
  } else if (ev.type === 'done') {
    if (last?.role === 'assistant' && last.streaming) {
      messages[messages.length - 1] = { ...last, streaming: false };
    }
  }
  return { ...task, messages };
}

// 流式事件批处理：50ms 合帧，done/error 等关键事件立即 flush
const batcher = new EventBatcher<StreamEvent>(50, (_taskId, events) => {
  useHubStore.getState().handleBatch(events);
});

export const useHubStore = create<HubState>((set, get) => ({
  clis: [],
  tasks: [],
  activeTaskId: null,
  runningTaskIds: new Set<string>(),
  settings: null,
  settingsOpen: false,
  error: null,
  pendingInsert: null,
  pendingPermissions: [],
  resolvedPermissions: {},
  previewPath: null,
  browserUrl: '',
  browserPanelOpen: false,
  rightTabs: [],
  activeRightTabId: null,
  rightPanelOpen: localStorage.getItem('rightPanelOpen') !== '0',
  expandedFileTaskId: null,
  modelEntries: [],

  init: async () => {
    const [clis, tasks, settings, modelEntries] = await Promise.all([
      window.hub.listClis(),
      window.hub.listTasks(),
      window.hub.getSettings(),
      window.hub.listModelEntries(),
    ]);
    set({
      clis,
      tasks: [...tasks].sort((a, b) => b.updatedAt - a.updatedAt),
      settings,
      modelEntries,
      activeTaskId: tasks.length > 0 ? [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null,
    });
    // 主窗口拦截的外部链接 → 右栏浏览器
    window.hub.onBrowserOpenUrl((url) => {
      get().setBrowserUrl(url);
    });
    // 权限审批请求
    window.hub.onPermissionRequest((req) => {
      set((s) => ({ pendingPermissions: [...s.pendingPermissions, req] }));
    });
    // 订阅流式事件：delta/thinking/tool 走 50ms 合帧；done/error/session/system 立即处理
    window.hub.onTaskEvent((ev) => {
      if (ev.type === 'delta' || ev.type === 'thinking' || ev.type === 'tool_call' || ev.type === 'tool_result') {
        batcher.push(ev.taskId, ev);
      } else {
        batcher.push(ev.taskId, ev, true);
      }
    });
  },

  refreshClis: async () => set({ clis: await window.hub.detectClis() }),
  refreshTasks: async () => {
    const fresh = [...(await window.hub.listTasks())].sort((a, b) => b.updatedAt - a.updatedAt);
    // 引用保持：内容未变的任务复用旧对象，MessageItem memo 不失效（否则整页 markdown 重渲染）
    const prev = get().tasks;
    const merged = fresh.map((task) => {
      const old = prev.find((p) => p.id === task.id);
      if (!old) return task;
      const sameLen = old.messages.length === task.messages.length;
      const lastOld = old.messages[old.messages.length - 1];
      const lastNew = task.messages[task.messages.length - 1];
      // 消息级比较：id/text/streaming + blocks 数 + 末块 args（TodoList/工具块内容变化也要捕获）
      const lastBlockArgs = (m: typeof lastOld) => {
        const blocks = m?.blocks;
        if (!blocks || blocks.length === 0) return '';
        const last = blocks[blocks.length - 1];
        return last.type === 'tool' ? `${last.args?.length ?? 0}:${last.result?.length ?? 0}:${last.status}` : last.text.length + '';
      };
      const sameLast = !lastOld && !lastNew ? true : lastOld?.id === lastNew?.id && lastOld?.text === lastNew?.text && lastOld?.streaming === lastNew?.streaming && lastBlockArgs(lastOld) === lastBlockArgs(lastNew) && (lastOld?.blocks?.length ?? 0) === (lastNew?.blocks?.length ?? 0);
      const sameMeta = old.title === task.title && old.cli === task.cli && old.modelEntryId === task.modelEntryId && old.effort === task.effort && old.pinned === task.pinned && old.permission === task.permission && old.model === task.model && old.changesClearedAt === task.changesClearedAt && old.todosClearedAt === task.todosClearedAt && old.planMode === task.planMode && old.goalMode === task.goalMode;
      return sameLen && sameLast && sameMeta ? old : task;
    });
    set({ tasks: merged });
  },
  refreshModelEntries: async () => set({ modelEntries: await window.hub.listModelEntries() }),

  setActive: (id) => set({ activeTaskId: id }),

  createTask: async (cliId, cwd) => {
    try {
      const task = await window.hub.createTask(cliId, cwd);
      await get().refreshTasks();
      set({ activeTaskId: task.id });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  removeTask: async (taskId) => {
    await window.hub.deleteTask(taskId);
    const { activeTaskId } = get();
    if (activeTaskId === taskId) set({ activeTaskId: null });
    await get().refreshTasks();
  },

  send: async (taskId, text, images) => {
    // 乐观渲染用户消息 + 空 assistant 占位（发送即显示，避免等待首包期间无反馈）
    // 新一轮对话开始：立即清空待办清单（todosClearedAt 标记过滤旧清单）
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              todosClearedAt: Date.now(),
              messages: [
                ...t.messages,
                localMsg('user', text, {
                  images: images?.map((i) => ({
                    dataUrl: `data:${i.mimeType};base64,${i.data}`,
                    mimeType: i.mimeType,
                    name: i.name,
                  })),
                }),
                localMsg('assistant', '', { streaming: true, blocks: [] }),
              ],
            }
          : t,
      ),
      runningTaskIds: new Set(s.runningTaskIds).add(taskId),
    }));
    try {
      await window.hub.sendMessage(taskId, text, images);
    } catch (err) {
      set((s) => {
        const ids = new Set(s.runningTaskIds);
        ids.delete(taskId);
        return {
          runningTaskIds: ids,
          error: err instanceof Error ? err.message : String(err),
        };
      });
    }
  },

  stop: async (taskId) => {
    await window.hub.stopTask(taskId);
    set((s) => {
      const ids = new Set(s.runningTaskIds);
      ids.delete(taskId);
      return { runningTaskIds: ids };
    });
  },

  applySettings: async (partial) => {
    const settings = await window.hub.setSettings(partial);
    set({ settings });
    if (partial.customPaths) await get().refreshClis();
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setError: (msg) => set({ error: msg }),

  // 预览文件：已有同路径 tab 则激活，否则新建 tab。path=null 关闭当前预览 tab
  respondPermission: async (requestId, optionId) => {
    await window.hub.respondPermission(requestId, optionId);
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter((r) => r.requestId !== requestId),
      resolvedPermissions: optionId
        ? { ...s.resolvedPermissions, [requestId]: optionId }
        : s.resolvedPermissions,
    }));
  },

  // 任务切换/重载时丢弃未处理请求并自动拒绝
  clearPermissionsFor: (taskId) => {
    const { pendingPermissions } = get();
    for (const req of pendingPermissions.filter((r) => r.taskId === taskId)) {
      void window.hub.respondPermission(req.requestId, null);
    }
    set((s) => ({ pendingPermissions: s.pendingPermissions.filter((r) => r.taskId !== taskId) }));
  },

  setPendingInsert: (text) => set({ pendingInsert: text }),
  setPreviewPath: (path, cwd) => {
    if (!path) {
      // 关闭当前激活的 preview tab
      const s = get();
      const active = s.rightTabs.find((t) => t.id === s.activeRightTabId);
      if (active && active.kind === 'preview') {
        get().closeRightTab(active.id);
      }
      return;
    }
    set((s) => {
      // 已有同路径 tab：激活它
      const exist = s.rightTabs.find((t) => t.kind === 'preview' && t.path === path);
      if (exist) {
        return { activeRightTabId: exist.id, previewPath: path, previewCwd: cwd };
      }
      // 新建 tab
      const tab: RightTab = { id: newTabId(), kind: 'preview', path, cwd, title: fileTitle(path) };
      return {
        rightTabs: [...s.rightTabs, tab],
        activeRightTabId: tab.id,
        previewPath: path,
        previewCwd: cwd,
      };
    });
  },

  // 浏览器：已有同 URL tab 则激活，否则新建 tab
  setBrowserUrl: (url) => {
    set((s) => {
      const exist = s.rightTabs.find((t) => t.kind === 'browser' && t.url === url);
      if (exist) {
        return { activeRightTabId: exist.id, browserUrl: url, browserPanelOpen: true };
      }
      const tab: RightTab = { id: newTabId(), kind: 'browser', url, title: urlTitle(url) };
      return {
        rightTabs: [...s.rightTabs, tab],
        activeRightTabId: tab.id,
        browserUrl: url,
        browserPanelOpen: true,
      };
    });
  },

  setBrowserPanelOpen: (open) => set({ browserPanelOpen: open }),

  openTestTab: () => {
    set((s) => {
      const exist = s.rightTabs.find((t) => t.kind === 'test');
      if (exist) return { activeRightTabId: exist.id, rightPanelOpen: true };
      const tab: RightTab = { id: newTabId(), kind: 'test', title: 'Test' };
      return { rightTabs: [...s.rightTabs, tab], activeRightTabId: tab.id, rightPanelOpen: true };
    });
  },
  closeRightTab: (id) => {
    set((s) => {
      const idx = s.rightTabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.rightTabs.filter((t) => t.id !== id);
      let activeId = s.activeRightTabId;
      if (activeId === id) {
        // 激活相邻 tab
        activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      }
      return { rightTabs: tabs, activeRightTabId: activeId };
    });
  },

  setActiveRightTab: (id) => set({ activeRightTabId: id }),

  setRightPanelOpen: (open) => {
    localStorage.setItem('rightPanelOpen', open ? '1' : '0');
    set({ rightPanelOpen: open });
  },
  toggleRightPanel: () => {
    set((s) => {
      const next = !s.rightPanelOpen;
      localStorage.setItem('rightPanelOpen', next ? '1' : '0');
      return { rightPanelOpen: next };
    });
  },

  toggleTaskFiles: (taskId) => set((s) => ({
    expandedFileTaskId: s.expandedFileTaskId === taskId ? null : taskId,
  })),

  // 批量应用：一批流式事件只触发一次状态更新（一次重渲染）
  handleBatch: (events) => {
    if (events.length === 0) return;
    set((state) => {
      let tasks = state.tasks;
      let runningTaskIds = state.runningTaskIds;
      let needRefresh = false;
      for (const ev of events) {
        tasks = tasks.map((t) => (t.id === ev.taskId ? applyEvent(t, ev) : t));
        if (ev.type === 'done' || ev.type === 'error') {
          if (runningTaskIds === state.runningTaskIds) runningTaskIds = new Set(state.runningTaskIds);
          runningTaskIds.delete(ev.taskId);
          needRefresh = true;
        }
      }
      if (needRefresh) setTimeout(() => void get().refreshTasks(), 0);
      return { tasks, runningTaskIds };
    });
  },

  handleEvent: (ev) => {
    set((s) => {
      const tasks = s.tasks.map((t) => (t.id === ev.taskId ? applyEvent(t, ev) : t));
      let runningTaskIds = s.runningTaskIds;
      if (ev.type === 'done' || ev.type === 'error') {
        runningTaskIds = new Set(s.runningTaskIds);
        runningTaskIds.delete(ev.taskId);
      }
      return { tasks, runningTaskIds };
    });
    if (ev.type === 'done') void get().refreshTasks(); // 与主进程持久化结果对齐
  },
}));
