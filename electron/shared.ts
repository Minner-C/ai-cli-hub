// 共享类型定义：主进程、preload、渲染进程三方共用
export type CliId = 'kimi' | 'claude' | 'gemini' | 'codex' | 'qwen' | 'opencode' | 'aider' | 'pi' | 'hermes';

export interface CliInfo {
  id: CliId;
  displayName: string;
  executable: string;      // 可执行文件名（未加扩展名）
  installed: boolean;
  resolvedPath?: string;   // 检测到的实际路径
  installHint: string;     // 未安装时的提示
}

// ---- 任务线程模型 ----
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

// 有序内容块：按事件实际发生顺序追加，恢复 text/thinking/tool 的交错时序
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool';
      toolId: string;
      name: string;
      args: string;
      result?: string;
      status: 'running' | 'done' | 'error';
    };

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;            // user/assistant/system 的文本；tool 为结果摘要
  toolName?: string;       // role=tool 时的工具名
  toolStatus?: 'running' | 'done' | 'error';
  toolArgs?: string;       // 工具参数（JSON 字符串）
  streaming?: boolean;     // assistant 流式中
  thinking?: string;       // （旧格式）assistant 的思考过程
  blocks?: ContentBlock[]; // 新格式：有序内容块（assistant 消息）
  ts: number;
  images?: Array<{ dataUrl: string; mimeType: string; name: string }>; // 图片附件（独立存储，不进 text）
  error?: boolean;       // 模型调用失败的错误消息（渲染为错误块，可重试）
  retryText?: string;    // 出错时的用户消息原文（重试用）
}

export interface TaskMeta {
  id: string;
  title: string;           // 首条用户消息截取
  cwd: string;
  cli: CliId;              // 当前底层 CLI
  model?: string;          // 任务级模型选择（未设置用 CLI 默认）
  modelEntryId?: string;   // 统一模型列表条目（选择即路由，优先于 model）
  effort?: EffortLevel;    // 任务级思考强度（未设置不注入）
  permission?: PermissionMode; // 任务级权限模式（未设置不注入）
  cliSessions: Partial<Record<CliId, string>>; // 各 CLI 的会话 id
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  changesClearedAt?: number; // 变更列表清空时间点（此前的改动不再显示）
  todosClearedAt?: number; // 待办清单清空时间点（此前的待办不再显示）
}

export interface Task extends TaskMeta {
  messages: ChatMessage[];
}

// ---- 流式事件（主进程 → 渲染进程，channel: task:event）----
export type StreamEvent =
  | { taskId: string; type: 'delta'; text: string }                 // assistant 增量
  | { taskId: string; type: 'thinking'; text: string }             // 思考过程增量（kimi headless 不提供，协议预留）
  | { taskId: string; type: 'tool_call'; toolId: string; name: string; args: string }
  | { taskId: string; type: 'tool_result'; toolId: string; result: string; isError?: boolean }
  | { taskId: string; type: 'session'; cli: CliId; sessionId: string }
  | { taskId: string; type: 'system'; text: string }                // 系统消息（如 CLI 切换）
  | { taskId: string; type: 'usage'; inputTokens: number; outputTokens: number; estimated: boolean }
  | { taskId: string; type: 'done' }
  | { taskId: string; type: 'error'; message: string };

// 不带 taskId 的事件载荷（分配式 Omit，保持联合分支）
export type StreamEventPayload = StreamEvent extends infer E
  ? E extends { taskId: string }
    ? Omit<E, 'taskId'>
    : never
  : never;

// ---- 切换 CLI ----
export interface SwitchPrepareResult {
  summary: string;
}

// 思考强度档位
export type EffortLevel = 'off' | 'low' | 'medium' | 'high';

// 权限模式档位：default=手动确认 / auto=自动批准安全操作 / yolo=跳过全部审批
export type PermissionMode = 'default' | 'auto' | 'yolo';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'zh' | 'en';

// 账号与密钥状态
export type AuthSource = 'app-key' | 'env' | 'logged-in' | 'none';
export interface CliAuthStatus {
  source: AuthSource;
  detail: string; // 来源说明：凭证文件路径或环境变量名
}

export type CloseBehavior = 'quit' | 'minimizeToTray';

export interface AppSettings {
  language: Language;
  theme: ThemeMode;
  customPaths: Partial<Record<CliId, string>>;
  // 各 CLI 默认模型（任务未单独指定时使用）
  defaultModels?: Partial<Record<CliId, string>>;
  activeProviders?: Partial<Record<CliId, string>>; // 各 CLI 生效的供应商预设 id
  customProviders?: ProviderPreset[];              // 用户自定义预设
  kimiShowThinking?: boolean;                      // kimi 用 text 模式以获取思考过程（实验）
  kimiUseAcp?: boolean;
  notificationsEnabled?: boolean; // 系统通知（审批/任务完成，未聚焦时），默认开                            // kimi 走 ACP 长连接模式（默认 true；false 回退 headless -p）
  closeBehavior?: CloseBehavior;                   // 关闭按钮行为：直接关闭 / 最小化到托盘（默认 minimizeToTray）
}

// ---- ACP 权限审批 ----
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string; // allow_once / allow_always / reject_once
  description?: string;
}

export interface PermissionRequestPayload {
  requestId: string;
  taskId: string;
  toolName: string;
  summary: string;
  options: PermissionOption[];
  planContent?: string; // 方案选择类请求的完整方案 markdown（ExitPlanMode 等）
}

// ---- 统一模型列表（软件级）：全局模型，任意 CLI 都可调用 ----
// 模型与 CLI 解耦：模型只定义协议/端点/密钥，路由时用任务当前 CLI 执行
// 不再管理 CLI 内置模型，不再有 native 协议

export type ModelProtocol = 'anthropic' | 'openai' | 'gemini';

// CLI → 协议优先级：每个 CLI 按优先级选择供应商已配置的协议端点
// 大多数平台同时支持 OpenAI 和 Anthropic，一个供应商填一次即可被所有 CLI 调用
export const CLI_PROTOCOL_PREFERENCE: Partial<Record<CliId, ModelProtocol[]>> = {
  claude:   ['anthropic'],              // Claude Code 仅支持 Anthropic 协议
  codex:    ['openai'],                 // Codex 仅支持 OpenAI 协议
  gemini:   ['gemini'],                 // Gemini CLI 仅支持 Gemini 协议
  kimi:     ['anthropic', 'openai'],    // Kimi Code 双协议，优先 Anthropic
  qwen:     ['openai'],                 // Qwen CLI 仅支持 OpenAI 协议
  opencode: ['openai'],                 // OpenCode 仅支持 OpenAI 协议
  aider:    ['openai'],                 // Aider 默认 OpenAI 协议
  pi:       ['openai'],                 // Pi 仅支持 OpenAI 协议
  hermes:   ['openai'],                 // Hermes 仅支持 OpenAI 协议
};

// 供应商：一个平台同时配置多协议端点（OpenAI/Anthropic/Gemini），可包含多款模型
// API Key 在供应商级共享（同一平台的 key 通用于多协议端点）
export interface ProviderEntry {
  id: string;              // 唯一 id
  displayName: string;     // 供应商显示名（如「智谱 AI」），同时用作品牌标识
  brand?: string;          // 品牌标识（用于判断是否 Google/Gemini 等特殊品牌）
  baseUrlOpenai?: string;      // OpenAI 协议端点（空字符串 = 官方默认；undefined = 未配置）
  baseUrlAnthropic?: string;   // Anthropic 协议端点
  baseUrlGemini?: string;      // Gemini 协议端点（仅 Google 官方）
  custom?: boolean;        // 用户自定义供应商
}

// 模型：只配置模型 ID、显示名、品牌 logo，API key/baseUrl 由所属供应商决定
export interface ModelEntry {
  id: string;             // 唯一 id
  displayName: string;
  modelId: string;        // 传给 CLI 的模型参数（空字符串 = 端点默认模型）
  providerId?: string;    // 所属供应商 id（为空则归为「未分组」）
  brand?: string;         // 模型图标标识（为空则用供应商 displayName）
  enabled: boolean;
  contextWindow?: number;  // 上下文窗口大小（tokens），用于 kimi config.toml max_context_size 和 UI 占用估算
  multimodal?: boolean;    // 是否支持图片输入，决定 kimi capabilities 是否包含 image_in
}

// 供应商品牌预设：供 UI 选择时自动填充多协议端点
// 大多数平台同时提供 OpenAI + Anthropic 端点；Google 官方仅 Gemini
export interface BrandPreset {
  brand: string;
  displayName: string;
  baseUrlOpenai?: string;      // OpenAI 协议端点（空字符串 = 官方默认；省略 = 不支持）
  baseUrlAnthropic?: string;   // Anthropic 协议端点
  baseUrlGemini?: string;      // Gemini 协议端点
  modelId?: string;       // 建议的默认模型 id（仅用于 UI 提示，不再自动填入模型）
}
export const BRAND_PRESETS: BrandPreset[] = [
  { brand: 'glm', displayName: '智谱 AI (BigModel)', baseUrlAnthropic: 'https://open.bigmodel.cn/api/anthropic', baseUrlOpenai: 'https://open.bigmodel.cn/api/paas/v4' },
  { brand: 'deepseek', displayName: 'DeepSeek', baseUrlAnthropic: 'https://api.deepseek.com/anthropic', baseUrlOpenai: 'https://api.deepseek.com/v1' },
  { brand: 'qwen', displayName: '阿里百炼 (DashScope)', baseUrlAnthropic: 'https://dashscope.aliyuncs.com/api/v2', baseUrlOpenai: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { brand: 'kimi', displayName: 'Kimi (Moonshot)', baseUrlAnthropic: 'https://api.moonshot.cn/anthropic', baseUrlOpenai: 'https://api.moonshot.cn/v1' },
  { brand: 'claude', displayName: 'Anthropic 官方', baseUrlAnthropic: '' },
  { brand: 'volcengine', displayName: '火山引擎方舟', baseUrlOpenai: 'https://ark.cn-beijing.volces.com/api/v3', baseUrlAnthropic: 'https://ark.cn-beijing.volces.com/api/coding', modelId: 'ark-code-latest' },
  { brand: 'openai', displayName: 'OpenAI 官方', baseUrlOpenai: 'https://api.openai.com/v1' },
  { brand: 'gemini', displayName: 'Google Gemini 官方', baseUrlGemini: '' },
];

// 路由解析结果：spawn 时的模型参数、注入 env 的变量名（CLI 由任务决定，不再由模型决定）
export interface ModelRoute {
  modelId: string;
  protocol: ModelProtocol;   // 实际选中的协议（决定环境变量名）
  envBaseUrl?: string;       // base URL 注入的环境变量名
  envKey?: string;           // API key 注入的环境变量名
  baseUrl?: string;
}

// 按 CLI 协议优先级从供应商选择协议：返回第一个已配置的协议，无则 null
export function selectProtocol(cli: CliId, provider: ProviderEntry): ModelProtocol | null {
  const prefs = CLI_PROTOCOL_PREFERENCE[cli];
  if (!prefs) return null;
  for (const proto of prefs) {
    if (proto === 'anthropic' && provider.baseUrlAnthropic !== undefined) return 'anthropic';
    if (proto === 'openai' && provider.baseUrlOpenai !== undefined) return 'openai';
    if (proto === 'gemini' && provider.baseUrlGemini !== undefined) return 'gemini';
  }
  return null;
}

// ---- 供应商预设（旧版，迁移进统一模型列表，保留类型用于迁移）----
export interface ProviderPreset {
  id: string;            // 预设 id（官方为 'official'，外部配置为 'external'）
  name: string;          // 显示名
  baseUrl: string;       // '' 表示官方默认端点
  envBaseUrl: string;    // base URL 注入的环境变量名
  envKey: string;        // API key 注入的环境变量名
  custom?: boolean;      // 用户自定义
  external?: boolean;    // 检测到的外部配置（如 ~/.claude/settings.json），只读
}

export interface ProviderState {
  presets: ProviderPreset[];   // 全部可用预设（含 external 若检测到）
  activeId: string;            // 当前生效预设 id
  hasKey: Record<string, boolean>; // 各预设是否已存 key
}

// ---- 模型 ----
export interface ModelInfo {
  id: string;          // 传给 CLI 的模型标识
  displayName: string;
}

// ---- Skill ----
export type SkillScope = 'builtin' | 'user' | 'project';
export interface SkillInfo {
  name: string;
  description: string;
  scope: SkillScope;
  enabled: boolean;
  path: string;        // 目录形式为目录路径，平铺形式为 .md 文件路径
  dirForm: boolean;
}

// ---- MCP ----
export type McpType = 'stdio' | 'http' | 'sse';
export interface McpServer {
  name: string;
  type: McpType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  supported: boolean;  // 该 CLI 是否支持 MCP 配置
}

// 内置 MCP 预设：常用 @modelcontextprotocol 服务器模板，一键载入编辑表单
export interface McpPreset {
  id: string;
  name: string;         // 服务器名称（写入配置的 key）
  title: string;        // 显示名
  description: string;  // 一句话描述
  type: McpType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  needsConfig: boolean; // 是否需要用户补充参数（路径/密钥等）
}

// 内置 Skill 模板：常用编程辅助 skill，一键创建为用户级 skill
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  content: string; // SKILL.md 完整内容（含 frontmatter）
}

// preload 暴露给渲染进程的 API 形状
export interface HubApi {
  listClis: () => Promise<CliInfo[]>;
  detectClis: () => Promise<CliInfo[]>;
  // 任务
  listTasks: () => Promise<Task[]>;
  createTask: (cliId: CliId, cwd: string) => Promise<Task>;
  deleteTask: (taskId: string) => Promise<void>;
  renameTask: (taskId: string, title: string) => Promise<void>;
  pinTask: (taskId: string, pinned: boolean) => Promise<void>;
  clearChanges: (taskId: string) => Promise<void>;
  clearTodos: (taskId: string) => Promise<void>;
  gitRestore: (cwd: string, paths: string[]) => Promise<{ restored: string[]; failed: string[]; notRepo: boolean }>;
  sendMessage: (taskId: string, text: string, images?: Array<{ data: string; mimeType: string; name: string }>) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  prepareSwitch: (taskId: string, targetCliId: CliId) => Promise<SwitchPrepareResult>;
  confirmSwitch: (taskId: string, targetCliId: CliId, summary: string) => Promise<void>;
  // 事件
  onTaskEvent: (cb: (ev: StreamEvent) => void) => () => void;
  // 其他
  pickDirectory: () => Promise<string | null>;
  pickExecutable: () => Promise<string | null>;
  getAppInfo: () => Promise<{ version: string }>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  onMenuAction: (cb: (action: string, payload?: unknown) => void) => () => void;
  // ACP 权限审批
  onPermissionRequest: (cb: (req: PermissionRequestPayload) => void) => () => void;
  respondPermission: (requestId: string, optionId: string | null) => Promise<boolean>;
  // 账号与密钥
  getAuthStatus: () => Promise<Record<CliId, CliAuthStatus>>;
  saveApiKey: (cliId: CliId, key: string) => Promise<void>;
  clearApiKey: (cliId: CliId) => Promise<void>;
  loginCli: (cliId: CliId) => Promise<{ ok: boolean; message: string }>;
  // 模型
  listModels: (cliId: CliId) => Promise<ModelInfo[]>;
  setTaskModel: (taskId: string, model: string) => Promise<void>;
  setTaskEffort: (taskId: string, effort: EffortLevel) => Promise<void>;
  getEffortSupport: (cliId: CliId) => Promise<{ supported: boolean; note?: string }>;
  setTaskPermission: (taskId: string, mode: PermissionMode) => Promise<void>;
  getPermissionSupport: (cliId: CliId) => Promise<{ supported: boolean; note?: string; via?: 'args' | 'config' | 'none' }>;
  readPermissionFromConfig: (cliId: CliId) => Promise<PermissionMode | undefined>;
  // 统一模型列表
  listModelEntries: () => Promise<ModelEntry[]>;
  saveModelEntry: (entry: ModelEntry) => Promise<void>;
  deleteModelEntry: (id: string) => Promise<void>;
  setTaskModelEntry: (taskId: string, entryId: string) => Promise<void>;
  testModelEntry: (entryId: string) => Promise<{ ok: boolean; message: string }>;
  // 供应商（含 API key/baseUrl 配置）
  listProviders: () => Promise<ProviderEntry[]>;
  saveProvider: (provider: ProviderEntry) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  saveProviderApiKey: (providerId: string, key: string) => Promise<void>;
  providerHasKey: (providerId: string) => Promise<boolean>;
  // 供应商
  getProviderState: (cliId: CliId) => Promise<ProviderState>;
  setActiveProvider: (cliId: CliId, presetId: string) => Promise<void>;
  saveProviderKey: (cliId: CliId, presetId: string, key: string) => Promise<void>;
  saveCustomProvider: (cliId: CliId, preset: ProviderPreset) => Promise<void>;
  // Skills
  listSkills: (cliId: CliId, cwd?: string) => Promise<SkillInfo[]>;
  toggleSkill: (path: string, dirForm: boolean, enable: boolean) => Promise<void>;
  createSkill: (cliId: CliId, name: string, description: string) => Promise<SkillInfo>;
  deleteSkill: (path: string) => Promise<void>;
  openSkill: (path: string) => Promise<void>;
  listSkillTemplates: () => Promise<SkillTemplate[]>;
  createSkillFromTemplate: (cliId: CliId, templateId: string) => Promise<SkillInfo>;
  // 用量
  getUsageSummary: (weeks?: number, sinceDays?: number) => Promise<UsageSummary>;
  getTaskUsage: (taskId: string) => Promise<{ input: number; output: number }>;
  getTaskUsageDetail: (taskId: string) => Promise<Array<{ cli: string; model: string; input: number; output: number }>>;
  // CLI 配置（设置页 CLI 设置分组）
  cliConfigReadRaw: (cliId: CliId) => Promise<import('./cliConfigManager').RawConfig>;
  cliConfigWriteRaw: (cliId: CliId, content: string) => Promise<void>;
  cliConfigRestoreBackup: (cliId: CliId) => Promise<void>;
  cliConfigHasBackup: (cliId: CliId) => Promise<boolean>;
  cliConfigReadDoc: (cliId: CliId) => Promise<Record<string, unknown>>;
  cliConfigWriteFields: (cliId: CliId, patch: Record<string, unknown>) => Promise<void>;
  cliVersion: (cliId: CliId) => Promise<string | null>;
  cliCheckLatest: (cliId: CliId) => Promise<string | null>;
  cliRunUpdate: (cliId: CliId) => Promise<void>;
  cliInstall: (cliId: CliId) => Promise<{ ok: boolean; message: string }>;
  runCodingHelper: () => Promise<{ ok: boolean; message: string }>;
  cliUpdate: (cliId: CliId) => Promise<{ ok: boolean; message: string }>;
  onInstallProgress: (cb: (cliId: CliId, chunk: string) => void) => () => void;
  onInstallDone: (cb: (cliId: CliId, ok: boolean, message: string) => void) => () => void;
  // 运行时环境（Node.js / Python）检测与一键安装
  checkRuntimes: () => Promise<import('./envInstaller').RuntimeStatus[]>;
  installRuntime: (kind: import('./envInstaller').RuntimeKind) => Promise<{ ok: boolean; message: string }>;
  onRuntimeProgress: (cb: (kind: import('./envInstaller').RuntimeKind, chunk: string) => void) => () => void;
  onRuntimeDone: (cb: (kind: import('./envInstaller').RuntimeKind, ok: boolean, message: string) => void) => () => void;
  // ACP adapter（claude-code-acp / codex-acp）检测与一键安装
  checkAdapters: () => Promise<import('./acpClient').AdapterStatus[]>;
  installAdapter: (cliId: CliId) => Promise<{ ok: boolean; message: string }>;
  onAdapterProgress: (cb: (cliId: CliId, chunk: string) => void) => () => void;
  onAdapterDone: (cb: (cliId: CliId, ok: boolean, message: string) => void) => () => void;
  // 文件面板
  listDir: (dir: string) => Promise<import('./filePanel').DirEntry[]>;
  listFilesFlat: (dir: string) => Promise<string[]>;
  saveImage: (cwd: string, dataBase64: string, mimeType: string) => Promise<string>;
  // 文件预览
  readFilePreview: (path: string, cwd?: string) => Promise<import('./filePreview').FilePreview>;
  writeFile: (path: string, content: string, cwd?: string) => Promise<import('./filePreview').WriteResult>;
  readClipboardImage: () => Promise<{ data: string; mimeType: string } | null>;
  openPath: (path: string, cwd?: string) => Promise<void>;
  revealInFolder: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  // MCP
  listMcpServers: (cliId: CliId) => Promise<McpServer[]>;
  upsertMcpServer: (cliId: CliId, server: McpServer, originalName?: string) => Promise<void>;
  deleteMcpServer: (cliId: CliId, name: string) => Promise<void>;
  setMcpEnabled: (cliId: CliId, name: string, enabled: boolean) => Promise<void>;
  listMcpPresets: () => Promise<McpPreset[]>;
  // 窗口控制（自定义标题栏）
  winMinimize: () => Promise<void>;
  winMaximizeToggle: () => Promise<void>;
  winClose: () => Promise<void>;
  winIsMaximized: () => Promise<boolean>;
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
}

// ---- Token 估算：按字符范围加权（比 chars/4 更准，尤其对中文）----
// ASCII（英文/数字/符号）：~4 字符/token；CJK（中日韩）：~1.3 字符/token；其他 Unicode：~2 字符/token
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      // ASCII
      tokens += 0.25;
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) ||  // CJK 统一表意文字（中文）
      (code >= 0x3400 && code <= 0x4dbf) ||  // CJK 扩展 A
      (code >= 0x3040 && code <= 0x30ff) ||  // 平假名 + 片假名
      (code >= 0xac00 && code <= 0xd7af)     // 韩文音节
    ) {
      // CJK：BPE 分词约 0.75 token/字
      tokens += 0.75;
    } else {
      // 其他 Unicode（emoji、扩展符号等）
      tokens += 0.5;
    }
  }
  return Math.max(1, Math.round(tokens));
}

// ---- 有序块装配：delta/thinking 追加到末尾同类块，tool_call 新开块，tool_result 更新对应块 ----

// 追加文本：兼容“累积快照”（新文本以旧文本开头则替换）与“增量”两种形态
function appendBlockText(existing: string, incoming: string): string {
  return incoming.startsWith(existing) && existing ? incoming : existing + incoming;
}

// 原地装配（调用方自行管理引用/持久化）
export function assembleEvent(blocks: ContentBlock[], ev: StreamEventPayload): void {
  const last = blocks[blocks.length - 1];
  if (ev.type === 'delta' && ev.text.trim()) {
    if (last?.type === 'text') last.text = appendBlockText(last.text, ev.text);
    else blocks.push({ type: 'text', text: ev.text });
  } else if (ev.type === 'thinking' && ev.text.trim()) {
    if (last?.type === 'thinking') last.text = appendBlockText(last.text, ev.text);
    else blocks.push({ type: 'thinking', text: ev.text });
  } else if (ev.type === 'tool_call') {
    // 同 toolId 已存在则更新（ACP 的 pending/in_progress 会重复推送），否则新开块
    const existing = blocks.find((b) => b.type === 'tool' && b.toolId === ev.toolId);
    if (existing && existing.type === 'tool') {
      if (ev.args) existing.args = ev.args;
      if (existing.status !== 'running') existing.status = 'running';
    } else {
      blocks.push({ type: 'tool', toolId: ev.toolId, name: ev.name, args: ev.args, status: 'running' });
    }
  } else if (ev.type === 'tool_result') {
    // 优先匹配同 toolId 的运行中块；找不到则匹配最后一个运行中块
    let target = [...blocks].reverse().find(
      (b) => b.type === 'tool' && b.status === 'running' && b.toolId === ev.toolId,
    );
    target ??= [...blocks].reverse().find((b) => b.type === 'tool' && b.status === 'running');
    if (target && target.type === 'tool') {
      target.result = ev.result;
      target.status = ev.isError ? 'error' : 'done';
    }
  }
}

// 旧格式兼容：聚合结构包装为 blocks（时序信息已丢失，保持原样展示）
export function messageBlocks(msg: ChatMessage): ContentBlock[] {
  if (msg.blocks) return msg.blocks;
  if (msg.role === 'assistant') {
    const blocks: ContentBlock[] = [];
    if (msg.thinking) blocks.push({ type: 'thinking', text: msg.thinking });
    if (msg.text) blocks.push({ type: 'text', text: msg.text });
    return blocks;
  }
  if (msg.role === 'tool') {
    return [{
      type: 'tool',
      toolId: msg.id,
      name: msg.toolName ?? 'tool',
      args: msg.toolArgs ?? '',
      result: msg.text,
      status: msg.toolStatus === 'running' ? 'running' : msg.toolStatus === 'error' ? 'error' : 'done',
    }];
  }
  return [{ type: 'text', text: msg.text }];
}

// blocks → 纯文本（标题、回退展示用）
export function blocksText(blocks: ContentBlock[]): string {
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ---- 用量统计类型与热力图分档（纯定义，渲染/主进程共用；勿引入 electron 依赖）----
export interface UsageRecord {
  taskId: string;
  projectCwd: string;
  cli: CliId;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  ts: number;
}

export interface UsageSummary {
  totalInput: number;
  totalOutput: number;
  todayInput: number;
  todayOutput: number;
  weekInput: number;
  weekOutput: number;
  byCli: Array<{ cli: string; input: number; output: number }>;
  byModel: Array<{ model: string; input: number; output: number }>;
  byProject: Array<{ cwd: string; input: number; output: number }>;
  daily7: Array<{ day: string; input: number; output: number }>;
  dailySeries: Array<{ day: string; input: number; output: number }>;
  hasEstimated: boolean;
  hasReal: boolean;
}

// 热力图分档：0=空，1-4 按相对 max 比例
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const r = value / max;
  if (r < 0.25) return 1;
  if (r < 0.5) return 2;
  if (r < 0.75) return 3;
  return 4;
}

// ---- 侧边栏任务分组（纯函数，可单测）----
export type TaskGroup = 'today' | 'yesterday' | 'week' | 'earlier';

export function groupOf(updatedAt: number, now: number): TaskGroup {
  const day = 86400_000;
  const startOfDay = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  if (updatedAt >= today) return 'today';
  if (updatedAt >= today - day) return 'yesterday';
  if (updatedAt >= today - 7 * day) return 'week';
  return 'earlier';
}

// 排序：置顶优先，其次按更新时间倒序
export function sortTasks<T extends { pinned?: boolean; updatedAt: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
