// claude headless 审批挂起：requestId → { proc, input }（进程退出自动 deny）
const pendingClaudePerms = new Map<string, { proc: import('child_process').ChildProcess; input: Record<string, unknown> }>();

// 主进程入口：窗口创建、设置持久化、任务/headless IPC 注册
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Tray, nativeImage, Notification } from 'electron';
import path from 'node:path';
import { HeadlessManager, toSpawnTarget } from './headlessManager';
import { detectClis, whichLike } from './cliManager';
import * as auth from './authManager';
import * as models from './modelManager';
import * as skills from './skillManager';
import * as mcp from './mcpManager';
import * as effort from './effortManager';
import * as permission from './permissionManager';
import * as envInstaller from './envInstaller';
import * as providers from './providerManager';
import { withKimiThinking, restoreKimiConfigIfPending } from './kimiThinking';
import { AcpManager, supportsAcp, getAcpProfile, listAdapterStatuses, installAdapter } from './acpClient';
import * as usageStore from './usageStore';
import * as cliConfig from './cliConfigManager';
import * as filePanel from './filePanel';
import { runCommand } from './installer';
import { safeSend } from './safeSend';
import * as modelRegistry from './modelRegistry';
import { syncCliCustomModel } from './cliModelAdapter';
import * as builtins from './builtinManager';
import { readFilePreview, resolvePreviewPath, writeFileContent } from './filePreview';
import { shell } from 'electron';
import * as taskStore from './taskStore';
import { store } from './taskStore';
import { assembleEvent, blocksText } from './shared';
import type { AppSettings, ChatMessage, CliId, ContentBlock, EffortLevel, McpServer, ModelEntry, PermissionMode, ProviderPreset, StreamEventPayload, ThemeMode } from './shared';

const headless = new HeadlessManager();
const acp = new AcpManager();
acp.onNotifyPermission = (toolName, summary) => notify('需要审批', `${toolName}: ${summary.slice(0, 80)}`);
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// 标记用户已确认退出，避免 close 拦截再次触发询问
let isQuitting = false;

// 切换 CLI 后待注入的上下文（taskId → 注入文本），下次发消息时消费
const pendingContext = new Map<string, string>();

const getSettings = (): AppSettings => store.get('settings');

// 各 CLI 的自定义模型配置适配已迁移到 cliModelAdapter.ts
// 统一入口 syncCliCustomModel(cli, entry) 为每个 CLI 写入对应的配置文件：
//   kimi→config.toml、codex→auth.json+config.toml、gemini→.env+settings.json、
//   claude/qwen→settings.json、opencode→opencode.json、hermes→config.yaml
// 返回 { modelArg, configChanged }：configChanged 时需杀掉旧 ACP 连接强制重建

// 任务生效模型：任务级选择优先，否则用该 CLI 的默认模型
function effectiveModel(task: { model?: string; cli: CliId }): string | undefined {
  return task.model ?? getSettings().defaultModels?.[task.cli];
}

function setSettings(partial: Partial<AppSettings>): AppSettings {
  const prev = getSettings();
  const next = { ...prev, ...partial };
  store.set('settings', next);
  nativeTheme.themeSource = next.theme as ThemeMode;
  return next;
}

function newMsg(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    text,
    ts: Date.now(),
    ...extra,
  };
}

// 解析 CLI 可执行路径；未安装抛错（渲染进程会展示）
async function requireCliPath(cliId: CliId): Promise<string> {
  const settings = getSettings();
  const custom = settings.customPaths?.[cliId];
  if (custom) return custom;
  const clis = await detectClis(settings);
  const info = clis.find((c) => c.id === cliId);
  if (!info?.installed || !info.resolvedPath) {
    throw new Error(`CLI not installed: ${cliId}. ${info?.installHint ?? ''}`);
  }
  return info.resolvedPath;
}

// 解析 ACP 可执行文件：原生=主CLI+acpArgs，adapter=adapter命令（未安装返回 null 回退 headless）
async function resolveAcpExecutable(
  cli: CliId,
  mainResolved: string,
): Promise<{ file: string; argsPrefix: string[]; acpArgs: string[] } | null> {
  const profile = getAcpProfile(cli);
  if (!profile) return null;
  if (profile.isAdapter && profile.adapterCommand) {
    // adapter 类：检测 adapter 可执行文件是否在 PATH
    const adapterPath = await whichLike(profile.adapterCommand);
    if (!adapterPath) return null; // adapter 未安装 → 回退 headless
    return { ...toSpawnTarget(adapterPath), acpArgs: profile.acpArgs };
  }
  // 原生类：用主 CLI + acpArgs（子命令/flag）
  return { ...toSpawnTarget(mainResolved), acpArgs: profile.acpArgs };
}

// 一次性 headless 调用：收集 assistant 全文（用于切换 CLI 前生成摘要）
function runOnce(taskId: string, cli: CliId, cwd: string, message: string, sessionId?: string, model?: string, effort?: import('./shared').EffortLevel): Promise<string> {
  return requireCliPath(cli).then(
    (resolved) =>
      new Promise<string>((resolve, reject) => {
        let text = '';
        const doRun = () => headless.run(
          {
            taskId,
            cli,
            cwd,
            message,
            sessionId,
            sender: null,
            textMode: cli === 'kimi' && Boolean(getSettings().kimiShowThinking),
            envExtra: { ...auth.envFor(cli), ...providers.providerEnv(cli, getSettings()) },
            extraArgs: models.modelArgs(cli, model),
            onEvent: (ev) => {
              if (ev.type === 'delta') text += ev.text;
              if (ev.type === 'error') reject(new Error(ev.message));
              if (ev.type === 'done') resolve(text.trim());
            },
          },
          toSpawnTarget(resolved),
        );
        // kimi 思考档位：临时改写 config.toml 生效；其他 CLI 直接跑
        if (cli === 'kimi' && effort) {
          void withKimiThinking(effort, doRun).catch(() => undefined);
        } else {
          void doRun();
        }
      }),
  );
}

function createTray() {
  // 托盘图标复用应用主图标
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../build/icon.ico');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    // 托盘图标尺寸较小，缩放到 16x16 避免过大
    icon.resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('AI CLI Hub');

  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (!mainWindow) createWindow();
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  // 单击托盘图标：显示主窗口
  tray.on('click', () => {
    if (!mainWindow) createWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 是否有任务正在进行（ACP 长连接或 headless 子进程）
function hasRunningTasks(): boolean {
  return acp.hasRunning() || headless.hasRunning();
}

// 处理关闭请求：根据设置与运行状态决策
// - closeBehavior='quit'：直接关闭（若有运行中任务则弹窗确认）
// - closeBehavior='minimizeToTray'（默认）：最小化到托盘，不退出
async function handleCloseRequest(): Promise<boolean> {
  // 用户已确认退出，放行
  if (isQuitting) return true;

  const behavior = getSettings().closeBehavior ?? 'minimizeToTray';

  if (behavior === 'minimizeToTray') {
    // 最小化到托盘：隐藏窗口即可，不退出进程
    if (mainWindow) mainWindow.hide();
    return false;
  }

  // behavior === 'quit'：直接关闭，但有运行中任务时弹窗确认
  if (hasRunningTasks()) {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: ['最小化到托盘', '直接关闭', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '确认关闭',
      message: '有任务正在进行中',
      detail: '关闭应用将中断正在进行的对话。是否最小化到托盘以保持任务运行？',
    });
    if (result.response === 0) {
      // 最小化到托盘
      if (mainWindow) mainWindow.hide();
      return false;
    } else if (result.response === 2) {
      // 取消
      return false;
    }
    // response === 1：直接关闭，继续退出流程
    isQuitting = true;
  }

  return true;
}

// 系统通知（未聚焦时）
function notify(title: string, body: string): void {
  if (getSettings().notificationsEnabled === false) return;
  if (mainWindow?.isFocused()) return;
  try {
    const n = new Notification({ title, body });
    n.on('click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    n.show();
  } catch { /* 不支持通知的平台忽略 */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  acp.attach(mainWindow.webContents);

  // 防止应用窗口被导航到外部网页（否则点击 markdown 链接后整个软件变成"浏览器"）
  // 任何非应用自身的导航都拦截，改用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 应用内部资源（dev 服务器、本地文件）允许新窗口
    if (url.startsWith('file://') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    // 外部链接一律丢给系统默认浏览器，避免在应用内打开成"浏览器"
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isInternal = url.startsWith('file://') ||
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1');
    if (isInternal) return; // 应用内部导航放行
    // 外部导航拦截：改用系统默认浏览器打开，防止应用被"变成浏览器"
    e.preventDefault();
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url);
    }
  });

  // 拦截关闭：根据设置决定是最小化到托盘还是退出
  mainWindow.on('close', async (e) => {
    if (isQuitting) return;
    const allowClose = await handleCloseRequest();
    if (!allowClose) {
      e.preventDefault();
    }
  });

  // 窗口销毁时清理悬空回调资源（ACP 长连接、headless 子进程）
  mainWindow.on('closed', () => {
    acp.killAll();
    headless.stopAll();
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// 主进程侧装配 + 持久化的 onEvent 工厂（headless 与 ACP 两条路径共用）
function createPersistOnEvent(taskId: string, retryText?: string) {
  const blocks: ContentBlock[] = [];
  let assistantMsg: ChatMessage | null = null;
  let realUsage: { inputTokens: number; outputTokens: number } | null = null;
  let usageSettled = false; // 一轮对话只结算一次（error+done、多 done 路径不重复追加）

  // done 时结算：真实 usage 或估算，写记录 + 追加轻量系统行
  const settleUsage = () => {
    if (usageSettled) return;
    usageSettled = true;
    const t = taskStore.getTask(taskId);
    if (!t) return;
    let input: number;
    let output: number;
    let estimated: boolean;
    if (realUsage) {
      input = realUsage.inputTokens;
      output = realUsage.outputTokens;
      estimated = false;
    } else {
      // 估算：含思考与工具块（字符数/4，标注估算）
      const est = usageStore.estimateTurnTokens(t.messages, blocks);
      input = est.input;
      output = est.output;
      estimated = true;
    }
    if (input <= 0 && output <= 0) return;
    // 自定义模型条目：t.model 为空时取条目的 modelId/displayName，避免统计显示为 (default)
    const entry = t.modelEntryId
      ? modelRegistry.listModelEntries().find((e) => e.id === t.modelEntryId)
      : undefined;
    const modelLabel = t.model ?? (entry ? entry.displayName || entry.modelId : undefined);
    usageStore.addUsageRecord({
      taskId,
      projectCwd: t.cwd,
      cli: t.cli,
      model: modelLabel,
      inputTokens: input,
      outputTokens: output,
      estimated,
      ts: Date.now(),
    });
    // 轻量系统行（弱化灰字），i18n 按当前语言
    const lang = getSettings().language;
    const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
    const line = lang === 'zh'
      ? `本轮消耗 ↑${fmt(input)} ↓${fmt(output)} tokens${estimated ? '（估算）' : ''}`
      : `Turn usage ↑${fmt(input)} ↓${fmt(output)} tokens${estimated ? ' (est.)' : ''}`;
    taskStore.appendMessage(taskId, newMsg('system', line));
  };

  const flushAssistant = (streaming: boolean) => {
    if (blocks.length === 0) return;
    const text = blocksText(blocks);
    if (!assistantMsg) {
      assistantMsg = newMsg('assistant', text, {
        streaming,
        blocks: blocks.map((b) => ({ ...b })),
      });
      taskStore.appendMessage(taskId, assistantMsg);
    } else {
      const t = taskStore.getTask(taskId);
      const m = t?.messages.find((x) => x.id === assistantMsg!.id);
      if (m) {
        m.text = text;
        m.streaming = streaming;
        m.blocks = blocks.map((b) => ({ ...b }));
        taskStore.saveTask(t!);
      }
    }
  };

  return (ev: StreamEventPayload) => {
    if (ev.type === 'session') {
      const t = taskStore.getTask(taskId);
      if (t) {
        t.cliSessions[ev.cli] = ev.sessionId;
        taskStore.saveTask(t);
      }
      return;
    }
    if (ev.type === 'error') {
      flushAssistant(false);
      taskStore.appendMessage(taskId, newMsg('system', ev.message, { error: true, retryText }));
      return;
    }
    if (ev.type === 'usage') {
      realUsage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      return;
    }
    if (ev.type === 'done') {
      flushAssistant(false);
      settleUsage();
      return;
    }
    if (ev.type === 'tool_result') ev.result = ev.result.slice(0, 4000);
    assembleEvent(blocks, ev);
    flushAssistant(true);
  };
}

function registerIpc() {
  ipcMain.handle('cli:list', () => detectClis(getSettings()));
  ipcMain.handle('cli:detect', () => detectClis(getSettings()));

  ipcMain.handle('task:list', () => taskStore.listTasks());
  ipcMain.handle('task:create', (_e, cliId: CliId, cwd: string) => taskStore.createTask(cliId, cwd));
  ipcMain.handle('task:rename', (_e, taskId: string, title: string) => {
    taskStore.updateTask(taskId, { title: title.trim().slice(0, 80) });
  });
  ipcMain.handle('task:pin', (_e, taskId: string, pinned: boolean) => {
    taskStore.updateTask(taskId, { pinned });
  });
  ipcMain.handle('task:clearChanges', (_e, taskId: string) => {
    taskStore.updateTask(taskId, { changesClearedAt: Date.now() });
  });
  ipcMain.handle('task:clearTodos', (_e, taskId: string) => {
    taskStore.updateTask(taskId, { todosClearedAt: Date.now() });
  });
  // git 还原：逐文件 git checkout --，失败收集
  ipcMain.handle('fs:gitRestore', async (_e, cwd: string, paths: string[]) => {
    const { execFile } = await import('node:child_process');
    const run = (args: string[]) =>
      new Promise<{ ok: boolean }>((resolve) => {
        execFile('git', args, { cwd, timeout: 15_000, windowsHide: true }, (err) => resolve({ ok: !err }));
      });
    const check = await run(['rev-parse', '--is-inside-work-tree']);
    if (!check.ok) return { restored: [], failed: paths, notRepo: true };
    const restored: string[] = [];
    const failed: string[] = [];
    for (const p of paths) {
      const rel = p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[\/]/, '') : p;
      const r = await run(['checkout', '--', rel]);
      (r.ok ? restored : failed).push(rel);
    }
    return { restored, failed, notRepo: false };
  });
  ipcMain.handle('task:delete', (_e, taskId: string) => {
    headless.stop(taskId);
    acp.kill(taskId);
    taskStore.deleteTask(taskId);
  });

  // 发送消息：持久化用户消息 → headless 运行 → 事件流持久化 + 推送
  ipcMain.handle('task:send', async (_e, taskId: string, text: string, images?: Array<{ data: string; mimeType: string; name: string }>) => {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    taskStore.appendMessage(
      taskId,
      newMsg('user', text, {
        images: images?.map((i) => ({
          dataUrl: `data:${i.mimeType};base64,${i.data}`,
          mimeType: i.mimeType,
          name: i.name,
        })),
      }),
    );

    // 消费切换 CLI 遗留的上下文注入
    const inject = pendingContext.get(taskId);
    pendingContext.delete(taskId);

    // 注意：resolved 先按任务当前 CLI 解析；若 modelEntryId 改了路由，下面会重算
    let resolved = await requireCliPath(task.cli);

    const settings = getSettings();

    // 统一模型列表路由：选中条目 → 注入 env + 模型参数（CLI 由任务决定，不再切换）
    let routeCli = task.cli;
    let routeModel = effectiveModel(task);
    let routeEnv: Record<string, string> = {};
    if (task.modelEntryId) {
      const entry = modelRegistry.listModelEntries().find((e) => e.id === task.modelEntryId);
      if (entry) {
        // CC Switch 方案：配置文件类 CLI（claude/codex/gemini/qwen/opencode/hermes/kimi）通过写入配置文件设置模型，
        // 不通过 spawn env 注入（spawn env 优先级高于配置文件，会导致冲突）；
        // 也不通过 ACP setConfigOption 设置（Claude Code ACP 会校验模型名，非 claude-* 模型报错）
        // 仅 kimi 需要通过 ACP setConfigOption 设置 alias
        // aider/pi 无配置文件适配器，通过 spawn env 注入端点和密钥
        const { modelArg, configChanged } = syncCliCustomModel(routeCli, entry);
        if (modelArg) {
          // kimi 返回 alias（通过 ACP setConfigOption 设置）；aider/pi 返回 modelId（通过 --model 参数设置）
          routeModel = modelArg;
          // aider/pi 无配置文件适配器，需要通过 env 注入供应商端点和密钥
          // kimi 已通过 config.toml 设置端点，不需要 env 注入
          if (routeCli !== 'kimi') {
            routeEnv = modelRegistry.routeEnv(entry, routeCli);
          }
        } else {
          // 配置文件类 CLI：模型已通过配置文件设置，不传 model 参数给 acp.prompt
          // 避免 setConfigOption 覆盖配置文件中的模型设置
          routeModel = undefined;
          // 不注入 routeEnv：配置文件类 CLI 的 baseUrl/apiKey 已写入配置文件，
          // spawn env 注入会与配置文件冲突（env 优先级更高但缺少 ANTHROPIC_MODEL 等字段）
          routeEnv = {};
        }
        // 配置文件变化（如 URL 智能修正、模型切换）时，强制杀旧 ACP 连接重建，
        // 让新进程读取最新配置文件（配置文件类 CLI 进程启动后不重读配置）
        if (configChanged) {
          acp.kill(taskId);
        }
        console.log(
          `[model-route] task=${taskId} entry=${entry.id} cli=${routeCli} ` +
          `model=${routeModel ?? '(via config file)'} envKeys=${Object.keys(routeEnv).join(',') || '(none)'}` +
          `${configChanged ? ' configChanged=true' : ''}`,
        );
      } else {
        console.warn(`[model-route] task=${taskId} modelEntryId=${task.modelEntryId} not found, fallback to built-in`);
      }
    }
    // ACP 路由：所有原生支持 ACP 的 CLI 走长连接；adapter 类需检测 adapter 已安装
    // kimi 保留 kimiUseAcp=false 开关以回退 headless（向后兼容）
    // 自定义模型同样可走 ACP：环境变量通过 spawn env 注入，模型通过 setConfigOption 设置
    let acpExecutable: { file: string; argsPrefix: string[]; acpArgs: string[] } | null = null;
    if (supportsAcp(routeCli) && !(routeCli === 'kimi' && settings.kimiUseAcp === false)) {
      acpExecutable = await resolveAcpExecutable(routeCli, resolved);
    }
    const useAcp = !!acpExecutable;

    // 图片附件：ACP 路径走 image block（协议标准支持）；headless 落盘到项目临时目录
    let acpImages: Array<{ data: string; mimeType: string }> | undefined;
    let effective = inject ? `${inject}\n\n${text}` : text;
    if (images?.length) {
      if (useAcp) {
        acpImages = images.map((i) => ({ data: i.data, mimeType: i.mimeType }));
      } else {
        const paths = images.map((i) => filePanel.saveImage(task.cwd, i.data, i.mimeType));
        effective += '\n\n[Attached images saved to project temp dir]\n' + paths.join('\n');
      }
    }

    const persistOnEvent = createPersistOnEvent(taskId, effective);

    if (useAcp && acpExecutable) {
      // ACP 路径：长驻连接、token 级流式、原生 model/thinking 选择器
      void (async () => {
        // 空轮检测：本轮是否有任何实质输出（防静默 done——用户只见用量行无任何内容）
        let hadContent = false;
        const trackEvent = (ev: StreamEventPayload) => {
          if (ev.type === 'delta' || ev.type === 'thinking' || ev.type === 'tool_call') hadContent = true;
          persistOnEvent(ev);
        };
        try {
          const result = await acp.prompt(taskId, routeCli, acpExecutable, task.cwd, effective, {
            images: acpImages,
            envExtra: { ...auth.envFor(routeCli), ...providers.providerEnv(routeCli, settings), ...routeEnv },
            storedSessionId: task.cliSessions[routeCli],
            model: routeModel,
            effort: task.effort,
            // ACP 权限模式实时下发，按 CLI 映射到各自 mode 值（kimi: default/auto/yolo；
            // claude: default/acceptEdits/bypassPermissions；gemini/qwen 各自变体）
            // 优先级：任务级 > kimi config.toml 显式值 > 回退 auto
            permission: permission.acpModeValue(
              routeCli,
              task.permission ??
                (routeCli === 'kimi' ? (permission.readPermissionFromConfig('kimi') ?? 'auto') : 'auto'),
            ),
            // 传递 modelEntryId：ensure 会检测变化并自动重建连接（配置文件类 CLI 需重读配置）
            modelEntryId: task.modelEntryId,
            onEvent: trackEvent,
          });
          if (result.sessionId && task.cliSessions[routeCli] !== result.sessionId) {
            const t = taskStore.getTask(taskId);
            if (t) {
              t.cliSessions[routeCli] = result.sessionId;
              taskStore.saveTask(t);
            }
          }
          if (!hadContent) {
            // 静默空轮：主动提示（可能是 403/上下文溢出/连接半死）
            const hint = getSettings().language === 'zh'
              ? '本轮模型无响应（可能额度受限、上下文超限或连接异常）。请重试，或新建对话/切换 CLI。'
              : 'No response this turn (quota, context limit, or connection issue). Please retry or switch CLI.';
            persistOnEvent({ type: 'error', message: hint });
            safeSend(mainWindow?.webContents, 'task:event', { type: 'error', message: hint, taskId });
          }
          persistOnEvent({ type: 'done' });
          safeSend(mainWindow?.webContents, 'task:event', { type: 'done', taskId });
          notify(getSettings().language === 'zh' ? '任务完成' : 'Task done', task.title || taskId.slice(-6));
        } catch (err) {
          acp.kill(taskId); // 下次发送时重建连接
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[acp] task=${taskId} cli=${routeCli} model=${routeModel ?? '(default)'} error:`, message);
          persistOnEvent({ type: 'error', message });
          persistOnEvent({ type: 'done' });
          safeSend(mainWindow?.webContents, 'task:event', { type: 'error', message, taskId });
          safeSend(mainWindow?.webContents, 'task:event', { type: 'done', taskId });
        }
      })();
      return;
    }

    // headless 路径（kimi fallback 与其他 CLI）
    const doRun = () => headless.run(
      {
        taskId,
        cli: routeCli,
        cwd: task.cwd,
        message: effective,
        sessionId: task.cliSessions[task.cli],
        sender: mainWindow?.webContents ?? null,
        textMode: routeCli === 'kimi' && Boolean(settings.kimiShowThinking),
        envExtra: { ...auth.envFor(routeCli), ...providers.providerEnv(routeCli, settings), ...routeEnv, ...effort.effortEnv(routeCli, task.effort) },
        extraArgs: [
          ...models.modelArgs(routeCli, routeModel),
          ...effort.effortArgs(routeCli, task.effort),
          ...permission.permissionArgs(routeCli, task.permission ?? 'auto'),
        ],
        onEvent: persistOnEvent,
        onControlRequest: routeCli === 'claude' ? (req) => {
          // claude control_request → 审批卡片（与 ACP 共用 PermissionRequestPayload 结构）
          const payload = {
            requestId: req.requestId,
            taskId,
            toolName: req.toolName,
            summary: req.summary,
            options: [
              { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
            ],
          };
          pendingClaudePerms.set(req.requestId, { proc: headless.getProc(taskId), input: req.rawInput });
          safeSend(mainWindow?.webContents, 'permission:request', payload);
          notify('需要审批', `${req.toolName}: ${req.summary.slice(0, 80)}`);
        } : undefined,
      },
      toSpawnTarget(resolved),
    );
    // kimi 思考档位（headless 路径）：临时改写 config.toml 生效（ACP 路径原生支持，不需要）
    if (routeCli === 'kimi' && task.effort) {
      void withKimiThinking(task.effort, doRun).catch(() => undefined);
    } else {
      void doRun();
    }
  });

  ipcMain.handle('permission:respond', (_e, requestId: string, optionId: string | null) => {
    // 先试 ACP
    if (acp.respondPermission(requestId, optionId)) return true;
    // 再试 claude headless 控制协议
    const pending = pendingClaudePerms.get(requestId);
    if (!pending) return false;
    pendingClaudePerms.delete(requestId);
    const allow = optionId === 'allow';
    try {
      pending.proc.stdin?.write(JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: allow
            ? { behavior: 'allow', updatedInput: pending.input }
            : { behavior: 'deny', message: 'User rejected' },
        },
      }) + '\n');
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('task:stop', (_e, taskId: string) => {
    headless.stop(taskId);
    void acp.stop(taskId);
    // 停止后立即收尾：清 streaming/运行态（kill 后 close 事件也会发 done，这里先补一次保证 UI 即时复位）
    safeSend(mainWindow?.webContents, 'task:event', { type: 'done', taskId });
  });

  // 切换 CLI：先用当前 CLI 生成摘要（界面预览），确认后切换并注入上下文
  ipcMain.handle('task:prepareSwitch', async (_e, taskId: string, targetCliId: CliId) => {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    // 目标 CLI 必须可用（提前报错）
    await requireCliPath(targetCliId);
    const summaryPrompt =
      '请用约200字总结当前进展、关键决定、已改文件和待办。纯文本输出，不要使用工具。';
    try {
      const summary = await runOnce(
        `${taskId}:summary`,
        task.cli,
        task.cwd,
        summaryPrompt,
        task.cliSessions[task.cli],
        effectiveModel(task),
        task.effort,
      );
      return { summary: summary || '' };
    } catch (err) {
      // 摘要失败不阻塞切换：回退为最近若干条消息拼接
      const fallback = task.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => `${m.role}: ${m.text.slice(0, 300)}`)
        .join('\n');
      return { summary: fallback || String(err) };
    }
  });

  ipcMain.handle('task:confirmSwitch', (_e, taskId: string, targetCliId: CliId, summary: string) => {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    taskStore.updateTask(taskId, { cli: targetCliId });
    taskStore.appendMessage(
      taskId,
      newMsg('system', `[switch → ${targetCliId}]\n${summary}`),
    );
    pendingContext.set(
      taskId,
      `[Context from previous session]\n${summary}\nPlease continue based on this context.`,
    );
  });

  ipcMain.handle('dialog:pickDirectory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      defaultPath: app.getPath('home'),
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // 选择可执行文件：用于 CLI 自定义路径
  ipcMain.handle('dialog:pickExecutable', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      defaultPath: app.getPath('home'),
      filters: process.platform === 'win32'
        ? [{ name: 'Executable', extensions: ['exe', 'cmd', 'bat', 'ps1'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // 账号与密钥
  ipcMain.handle('auth:status', () => auth.detectAllAuth());
  ipcMain.handle('auth:saveKey', (_e, cliId: CliId, key: string) => auth.saveApiKey(cliId, key));
  ipcMain.handle('auth:clearKey', (_e, cliId: CliId) => auth.clearApiKey(cliId));
  ipcMain.handle('auth:login', (_e, cliId: CliId) => auth.launchLogin(cliId));

  // 统一模型列表
  ipcMain.handle('modelEntries:list', () => modelRegistry.listModelEntries());
  ipcMain.handle('modelEntries:save', (_e, entry: import('./shared').ModelEntry) =>
    modelRegistry.saveModelEntry(entry),
  );
  ipcMain.handle('modelEntries:delete', (_e, id: string) => modelRegistry.deleteModelEntry(id));
  ipcMain.handle('modelEntries:setTaskEntry', (_e, taskId: string, entryId: string) => {
    taskStore.updateTask(taskId, { modelEntryId: entryId });
  });
  // 供应商（含 API key/baseUrl 配置）
  ipcMain.handle('providers:list', () => modelRegistry.listProviders());
  ipcMain.handle('providers:save', (_e, provider: import('./shared').ProviderEntry) =>
    modelRegistry.saveProvider(provider),
  );
  ipcMain.handle('providers:delete', (_e, id: string) => modelRegistry.deleteProvider(id));
  ipcMain.handle('providers:saveKey', (_e, providerId: string, key: string) =>
    modelRegistry.saveProviderKey(providerId, key),
  );
  ipcMain.handle('providers:hasKey', (_e, providerId: string) =>
    modelRegistry.providerHasKey(providerId),
  );
  ipcMain.handle('modelEntries:test', async (_e, entryId: string) => {
    const entry = modelRegistry.listModelEntries().find((e) => e.id === entryId);
    if (!entry) return { ok: false, message: 'entry not found' };
    // 模型与 CLI 解耦：测试时选一个已安装的兼容 CLI（优先 claude，支持 anthropic/openai 协议）
    const cliPrefs: CliId[] = ['claude', 'codex', 'gemini', 'qwen', 'kimi', 'opencode', 'aider', 'pi'];
    const clis = await detectClis(getSettings());
    const testCli = cliPrefs.find((c) => clis.find((ci) => ci.id === c && ci.installed));
    if (!testCli) return { ok: false, message: 'no CLI installed for testing' };
    try {
      const resolved = await requireCliPath(testCli);
      // 统一通过 syncCliCustomModel 写入配置文件（适配各 CLI 的配置格式）
      let testModelId = entry.modelId;
      const { modelArg } = syncCliCustomModel(testCli, entry);
      if (modelArg) testModelId = modelArg;
      // 最小请求测试连接（headless 短 prompt）
      const { HeadlessManager } = await import('./headlessManager');
      const hm = new HeadlessManager();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout (30s)')), 30_000);
        void hm.run(
          {
            taskId: 'test:' + entryId,
            cli: testCli,
            cwd: app.getPath('home'),
            message: '回复ok两个字',
            sender: null,
            envExtra: { ...auth.envFor(testCli), ...modelRegistry.routeEnv(entry, testCli) },
            extraArgs: testModelId ? models.modelArgs(testCli, testModelId) : [],
            onEvent: (ev) => {
              if (ev.type === 'delta') {
                clearTimeout(timer);
                resolve();
              }
              if (ev.type === 'error') {
                clearTimeout(timer);
                reject(new Error(ev.message));
              }
              if (ev.type === 'done') {
                clearTimeout(timer);
                resolve();
              }
            },
          },
          toSpawnTarget(resolved),
        );
      });
      return { ok: true, message: 'ok' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  // CLI 配置（设置页 CLI 设置分组）
  ipcMain.handle('cliConfig:readRaw', (_e, cliId: CliId) => cliConfig.readConfigRaw(cliId));
  ipcMain.handle('cliConfig:writeRaw', (_e, cliId: CliId, content: string) =>
    cliConfig.writeConfigRaw(cliId, content),
  );
  ipcMain.handle('cliConfig:restore', (_e, cliId: CliId) => cliConfig.restoreConfigBackup(cliId));
  ipcMain.handle('cliConfig:hasBackup', (_e, cliId: CliId) => cliConfig.hasConfigBackup(cliId));
  ipcMain.handle('cliConfig:readDoc', (_e, cliId: CliId) => cliConfig.readConfigDoc(cliId));
  ipcMain.handle('cliConfig:writeFields', (_e, cliId: CliId, patch: Record<string, unknown>) =>
    cliConfig.writeConfigFields(cliId, patch),
  );
  ipcMain.handle('cli:version', async (_e, cliId: CliId) => {
    const clis = await detectClis(getSettings());
    const info = clis.find((c) => c.id === cliId);
    if (!info?.resolvedPath) return null;
    return cliConfig.detectCliVersion(cliId, toSpawnTarget(info.resolvedPath));
  });
  ipcMain.handle('cli:checkLatest', (_e, cliId: CliId) => cliConfig.checkLatestVersion(cliId));
  ipcMain.handle('cli:runUpdate', (_e, cliId: CliId) => cliConfig.runUpdateInTerminal(cliId));
  // 应用内安装（不弹外部终端）：流式输出推送 + 完成事件
  ipcMain.handle('cli:installStart', async (_e, cliId: CliId) => {
    const cmd = cliConfig.installCommandOf(cliId);
    if (!cmd) return { ok: false, message: 'no install command for this CLI' };
    const tool = cliId === 'aider' || cliId === 'hermes' ? 'pip' : 'npm';
    const avail = await import('./terminal').then((t) => t.checkToolAvailable(tool));
    if (!avail.ok) {
      // 运行时缺失：提示去环境条安装（i18n key 由前端翻译）
      const runtimeKey = tool === 'pip' ? 'python' : 'node';
      return { ok: false, message: `runtime:missing:${runtimeKey}` };
    }
    void (async () => {
      const result = await runCommand(`install:${cliId}`, cmd, (chunk) => {
        safeSend(mainWindow?.webContents, 'cli:installProgress', cliId, chunk);
      });
      const ok = result.code === 0;
      safeSend(mainWindow?.webContents, 'cli:installDone',
        cliId,
        ok,
        ok ? '' : result.error ?? `exit code ${result.code}`,
      );
    })();
    return { ok: true, message: '' };
  }),
  ipcMain.handle('cli:updateStart', async (_e, cliId: CliId) => {
    const cmd = cliConfig.updateCommandOf(cliId);
    if (!cmd) return { ok: false, message: 'no update command for this CLI' };
    void (async () => {
      const result = await runCommand(`update:${cliId}`, cmd, (chunk) => {
        safeSend(mainWindow?.webContents, 'cli:installProgress', cliId, chunk);
      });
      const ok = result.code === 0;
      safeSend(mainWindow?.webContents, 'cli:installDone',
        cliId,
        ok,
        ok ? '' : result.error ?? `exit code ${result.code}`,
      );
    })();
    return { ok: true, message: '' };
  }),
  // GLM Coding Plan 官方配置向导（交互式 TUI，外部终端执行）
  ipcMain.handle('cli:runCodingHelper', async () => {
    const avail = await import('./terminal').then((t) => t.checkToolAvailable('npm'));
    if (!avail.ok) return avail;
    const { openTerminalWithCommand } = await import('./terminal');
    openTerminalWithCommand('npx @z_ai/coding-helper');
    return { ok: true, message: '' };
  }),
  // 登录保持外部终端（交互式）
  ipcMain.handle('cli:install', (_e, cliId: CliId) => cliConfig.runInstallInTerminal(cliId));

  // 运行时环境（Node.js / Python）检测与一键安装
  ipcMain.handle('env:check', () => envInstaller.checkAllRuntimes());
  ipcMain.handle('env:install', async (_e, kind: envInstaller.RuntimeKind) => {
    void (async () => {
      const result = await envInstaller.installRuntime(kind, (chunk) => {
        safeSend(mainWindow?.webContents, 'env:progress', kind, chunk);
      });
      const ok = result.code === 0;
      safeSend(mainWindow?.webContents, 'env:done', kind, ok, ok ? '' : result.error ?? `exit code ${result.code}`);
    })();
    return { ok: true, message: '' };
  }),

  // ACP adapter（claude-code-acp / codex-acp）检测与一键安装
  ipcMain.handle('acp:checkAdapters', () => listAdapterStatuses());
  ipcMain.handle('acp:installAdapter', async (_e, cliId: CliId) => {
    void (async () => {
      const result = await installAdapter(cliId, (chunk) => {
        safeSend(mainWindow?.webContents, 'acp:progress', cliId, chunk);
      });
      const ok = result.code === 0;
      safeSend(mainWindow?.webContents, 'acp:done', cliId, ok, ok ? '' : result.error ?? `exit code ${result.code}`);
    })();
    return { ok: true, message: '' };
  }),

  // 用量
  ipcMain.handle('usage:summary', (_e, weeks?: number, sinceDays?: number) =>
    usageStore.summarizeUsage(usageStore.listUsageRecords(), weeks ?? 16, sinceDays),
  );
  ipcMain.handle('usage:task', (_e, taskId: string) => usageStore.taskUsage(taskId));
  ipcMain.handle('usage:taskDetail', (_e, taskId: string) => usageStore.taskUsageDetail(taskId));

  // 文件预览
  ipcMain.handle('fs:listDir', (_e, dir: string) => filePanel.listDir(dir));
  ipcMain.handle('fs:listFilesFlat', (_e, dir: string) => filePanel.listFilesFlat(dir));
  ipcMain.handle('fs:saveImage', (_e, cwd: string, data: string, mime: string) =>
    filePanel.saveImage(cwd, data, mime),
  );
  ipcMain.handle('fs:readPreview', (_e, p: string, cwd?: string) => readFilePreview(p, cwd));
  ipcMain.handle('fs:writeFile', (_e, p: string, content: string, cwd?: string) =>
    writeFileContent(p, content, cwd),
  );
  ipcMain.handle('fs:openExternal', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('fs:openPath', (_e, p: string, cwd?: string) =>
    shell.openPath(resolvePreviewPath(p, cwd)),
  );
  ipcMain.handle('fs:revealInFolder', (_e, p: string) => shell.showItemInFolder(p));

  // 原生剪贴板读图（微信截图等不暴露 File 的场景，Chromium clipboardData 拿不到）
  ipcMain.handle('clipboard:readImage', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return { data: img.toPNG().toString('base64'), mimeType: 'image/png' };
  });

  // 模型
  ipcMain.handle('model:list', async (_e, cliId: CliId) => {
    let kimiExe: string | undefined;
    if (cliId === 'kimi') {
      const clis = await detectClis(getSettings());
      kimiExe = clis.find((c) => c.id === 'kimi')?.resolvedPath;
    }
    return models.listModels(cliId, kimiExe);
  });
  ipcMain.handle('task:setModel', (_e, taskId: string, model: string) => {
    taskStore.updateTask(taskId, { model });
  });
  ipcMain.handle('task:setEffort', (_e, taskId: string, lvl: EffortLevel) => {
    taskStore.updateTask(taskId, { effort: lvl });
  });
  ipcMain.handle('effort:support', (_e, cliId: CliId) => effort.effortSupport(cliId));
  ipcMain.handle('task:setPermission', (_e, taskId: string, mode: PermissionMode) => {
    const task = taskStore.getTask(taskId);
    // 配置文件类 CLI：写入配置文件立即生效
    if (task) {
      const support = permission.permissionSupport(task.cli);
      if (support.via === 'config') {
        try {
          permission.writePermissionToConfig(task.cli, mode);
        } catch (err) {
          // 配置写入失败不阻塞任务更新，但向上抛出让前端提示
          throw new Error(`Failed to write permission config: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // ACP 长驻连接：实时下发 mode（按 CLI 映射各自 mode 值），长驻进程不会重读配置
      const acpMode = permission.acpModeValue(task.cli, mode);
      if (acpMode) void acp.setSessionOption(taskId, 'mode', acpMode);
    }
    taskStore.updateTask(taskId, { permission: mode });
  });
  ipcMain.handle('permission:support', (_e, cliId: CliId) => permission.permissionSupport(cliId));
  // 读取配置文件中的当前权限模式（用于配置文件类 CLI 的初始展示）
  ipcMain.handle('permission:readConfig', (_e, cliId: CliId) => permission.readPermissionFromConfig(cliId));

  // 供应商
  ipcMain.handle('provider:state', (_e, cliId: CliId) => providers.getProviderState(cliId, getSettings()));
  ipcMain.handle('provider:setActive', (_e, cliId: CliId, presetId: string) => {
    providers.setActiveProvider(cliId, presetId, getSettings());
  });
  ipcMain.handle('provider:saveKey', (_e, _cliId: CliId, presetId: string, key: string) =>
    providers.saveProviderKey(presetId, key),
  );
  ipcMain.handle('provider:saveCustom', (_e, cliId: CliId, preset: ProviderPreset) =>
    providers.saveCustomProvider(cliId, preset, getSettings()),
  );

  // Skills
  ipcMain.handle('skill:list', async (_e, cliId: CliId, cwd?: string) => {
    const dirSkills = skills.listDirSkills(cliId, cwd);
    let claudeTarget;
    if (cliId === 'claude') {
      const clis = await detectClis(getSettings());
      const resolved = clis.find((c) => c.id === 'claude')?.resolvedPath;
      if (resolved) claudeTarget = toSpawnTarget(resolved);
    }
    const builtinSkills = await builtins.listBuiltinSkills(cliId, claudeTarget);
    return [...builtinSkills, ...dirSkills];
  });
  ipcMain.handle('skill:toggle', (_e, p: string, _dirForm: boolean, enable: boolean) =>
    skills.toggleSkill(p, enable),
  );
  ipcMain.handle('skill:create', (_e, cliId: CliId, name: string, description: string) =>
    skills.createSkill(cliId, name, description),
  );
  ipcMain.handle('skill:delete', (_e, p: string) => skills.deleteSkill(p));
  ipcMain.handle('skill:open', (_e, p: string) => skills.openSkill(p));
  ipcMain.handle('skill:templates', () => skills.listSkillTemplates());
  ipcMain.handle('skill:createFromTemplate', (_e, cliId: CliId, templateId: string) =>
    skills.createSkillFromTemplate(cliId, templateId),
  );

  // MCP
  ipcMain.handle('mcp:list', (_e, cliId: CliId) => mcp.listMcpServers(cliId));
  ipcMain.handle('mcp:upsert', (_e, cliId: CliId, server: McpServer, originalName?: string) =>
    mcp.upsertMcpServer(cliId, server, originalName),
  );
  ipcMain.handle('mcp:delete', (_e, cliId: CliId, name: string) => mcp.deleteMcpServer(cliId, name));
  ipcMain.handle('mcp:setEnabled', (_e, cliId: CliId, name: string, enabled: boolean) =>
    mcp.setMcpEnabled(cliId, name, enabled),
  );
  ipcMain.handle('mcp:presets', () => mcp.listMcpPresets());

  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => setSettings(partial));

  // 自定义标题栏：窗口控制
  ipcMain.handle('win:minimize', () => mainWindow?.minimize());
  ipcMain.handle('win:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('win:close', () => mainWindow?.close());
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false);
  // 最大化/还原状态变化时通知渲染进程（用于切换按钮图标）
  const notifyMax = () => {
    mainWindow?.webContents.send('win:maximizeChanged', mainWindow?.isMaximized() ?? false);
  };
  if (mainWindow) {
    mainWindow.on('maximize', notifyMax);
    mainWindow.on('unmaximize', notifyMax);
  }
}

// 兜底：未捕获异常记日志而不是弹系统错误框（根本修复靠 safeSend 与资源清理）
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

app.whenReady().then(() => {
  // 上次异常退出若遗留 kimi config 临时改写，先恢复
  restoreKimiConfigIfPending();
  // 移除原生菜单栏（Windows 左上角按钮），功能收进应用内设置面板
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = getSettings().theme;
  registerIpc();

  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 窗口全部关闭时：有托盘则保留进程（用户从托盘退出），macOS 也保留
app.on('window-all-closed', () => {
  if (tray || process.platform === 'darwin') return;
  app.quit();
});

// 退出前杀掉所有 headless 子进程
app.on('before-quit', () => {
  isQuitting = true;
  headless.stopAll();
  acp.killAll();
});
