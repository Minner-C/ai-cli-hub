// 任务持久化：electron-store 存任务元数据 + 消息历史，重启可恢复
import Store from 'electron-store';
import type { Task, ChatMessage, CliId, AppSettings } from './shared';
import { fixToolMessages } from './mojibake';

interface PersistedShape {
  settings: AppSettings;
  tasks: Task[];
}

export const store = new Store<PersistedShape>({
  defaults: {
    settings: { language: 'zh', theme: 'system', customPaths: {}, closeBehavior: 'minimizeToTray' },
    tasks: [],
  },
});

const MAX_MESSAGES_PER_TASK = 500;

// 加载时清理：应用重启即无活动生成，残留的 streaming 标志一律清除（否则历史消息永久挂流式光标）；
// 同时剥离可能混入文本末尾的光标字符 ▍
const DATA_URL_RE = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,}/g;

function sanitizeMessage(msg: ChatMessage): ChatMessage {
  const strip = (s: string) => s.replace(/▍+\s*$/, '');
  let changed = false;
  const out = { ...msg };
  // 历史脏数据：text 里混入的 data:image base64 长串 → 剥离转为图片附件
  // 注意：tool 角色的消息（ReadMediaFile 结果等）base64 可能因持久化截断而损坏，
  // 且本就是喂给模型的数据，只替换占位、不转附件
  const matches = msg.text.match(DATA_URL_RE);
  if (matches) {
    changed = true;
    if (msg.role !== 'tool') {
      const images = [...(out.images ?? [])];
      for (const m of matches) {
        const mimeType = m.match(/data:(image\/[a-zA-Z]+);base64,/)?.[1] ?? 'image/png';
        images.push({ dataUrl: m, mimeType, name: 'pasted-image' });
      }
      out.images = images;
    }
    out.text = msg.text.replace(DATA_URL_RE, '[图片]').replace(/\[图片\](\s*\[图片\])+/g, '[图片]');
  }
  if (out.streaming) {
    out.streaming = false;
    changed = true;
  }
  if (out.text.endsWith('▍')) {
    out.text = strip(out.text);
    changed = true;
  }
  if (out.blocks) {
    out.blocks = out.blocks.map((b) => {
      if (b.type === 'text') {
        const m = b.text.match(DATA_URL_RE);
        if (m) {
          changed = true;
          out.images = [
            ...(out.images ?? []),
            ...m.map((d) => ({
              dataUrl: d,
              mimeType: d.match(/data:(image\/[a-zA-Z]+);base64,/)?.[1] ?? 'image/png',
              name: 'pasted-image',
            })),
          ];
          return { ...b, text: b.text.replace(DATA_URL_RE, '[图片]') };
        }
      }
      if ((b.type === 'text' || b.type === 'thinking') && b.text.endsWith('▍')) {
        changed = true;
        return { ...b, text: strip(b.text) };
      }
      return b;
    });
  }
  return changed ? out : msg;
}

// 内存缓存：避免每次全量读盘+全量 sanitize（流式期间每秒数十次调用）
let tasksCache: Task[] | null = null;

function rawTasks(): Task[] {
  if (tasksCache === null) tasksCache = store.get('tasks');
  return tasksCache;
}

export function listTasks(): Task[] {
  // 历史消息展示时应用乱码修复（展示态副本）
  return rawTasks().map((task) => {
    // 旧数据迁移：plan 从 permission 字段拆为独立轴之前的残留
    const t = task.permission === 'plan'
      ? { ...task, planMode: true, permission: undefined }
      : task;
    return {
      ...t,
      messages: fixToolMessages(t.messages).map(sanitizeMessage),
    };
  });
}

export function getTask(id: string): Task | undefined {
  return listTasks().find((t) => t.id === id);
}

// ---- 写盘防抖：流式期间高频 saveTask 只改内存，合并落盘 ----
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

export function saveTask(task: Task): void {
  const tasks = rawTasks(); // 写内存原始数据，不是 sanitize 副本
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  dirty = true;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (dirty) {
        dirty = false;
        // 注意：写内存态（含 sanitize 后的展示态会丢图片等——所以内存中存原始任务）
        store.set('tasks', rawTasks());
      }
    }, 300);
  }
}

// 退出前强制落盘
export function flushTasksNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (dirty) {
    dirty = false;
    store.set('tasks', rawTasks());
  }
}

export function deleteTask(id: string): void {
  tasksCache = rawTasks().filter((t) => t.id !== id);
  flushTasksNow();
}

export function createTask(cli: CliId, cwd: string): Task {
  const now = Date.now();
  const task: Task = {
    id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    cwd,
    cli,
    cliSessions: {},
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  saveTask(task);
  return task;
}

// 追加消息；首条用户消息同时作为任务标题
export function appendMessage(taskId: string, msg: ChatMessage): Task | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  task.messages.push(msg);
  if (task.messages.length > MAX_MESSAGES_PER_TASK) {
    task.messages.splice(0, task.messages.length - MAX_MESSAGES_PER_TASK);
  }
  if (!task.title && msg.role === 'user') {
    task.title = msg.text.replace(/\s+/g, ' ').slice(0, 40);
  }
  task.updatedAt = Date.now();
  saveTask(task);
  return task;
}

export function updateTask(taskId: string, patch: Partial<Task>): Task | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  Object.assign(task, patch, { updatedAt: Date.now() });
  saveTask(task);
  return task;
}
