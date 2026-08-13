// ACP（Agent Client Protocol）客户端：所有原生支持 ACP 的 CLI 的持久连接管理
// 协议：stdio 换行分隔 JSON-RPC 2.0（手写帧解析，不依赖 SDK）
// 支持 CLI（含原生子命令/flag 与 Zed 维护的 adapter）：
//   - kimi:     kimi acp                      （原生子命令）
//   - qwen:     qwen --acp                     （原生 flag）
//   - opencode: opencode acp                   （原生子命令）
//   - gemini:   gemini --experimental-acp      （原生实验 flag）
//   - claude:   claude-code-acp                （Zed adapter，需单独安装 @zed-industries/claude-code-acp）
//   - codex:    codex-acp                      （Zed adapter，需单独安装 @zed-industries/codex-acp）
// 实测（探针 scripts/probe-acp.cjs）：
//   - agent_thought_chunk：token 级思考流
//   - tool_call(pending) → tool_call_update(in_progress, 参数增量) → completed/failed
//   - agent_message_chunk：token 级正文流
//   - configOptions：model / thinking(thought_level, k3 仅 on) / mode(default|plan|auto|yolo)
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import type { StreamEventPayload, CliId } from './shared';
import { fixMojibake } from './mojibake';
import { safeSend } from './safeSend';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ACP 帧诊断日志（静默空轮排查）：~/.ai-cli-hub/acp-debug.log
const DEBUG_LOG = path.join(os.homedir(), '.ai-cli-hub', 'acp-debug.log');
export function acpLog(direction: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    const line = typeof data === 'string' ? data : JSON.stringify(data);
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${direction} ${line.slice(0, 500)}
`);
  } catch { /* ignore */ }
}
import type { PermissionOption, PermissionRequestPayload } from './shared';

// ---- 各 CLI 的 ACP 启动配置 ----
export interface AcpProfile {
  acpArgs: string[];         // ACP 启动参数（子命令或 flag）
  adapterCommand?: string;   // adapter 类：独立的 adapter 可执行文件名（与主 CLI 分离）
  adapterPackage?: string;   // adapter 类：npm 包名（用于一键安装）
  isAdapter?: boolean;       // 是否为 adapter 类（需单独检测安装）
}

const ACP_PROFILES: Partial<Record<CliId, AcpProfile>> = {
  kimi:     { acpArgs: ['acp'] },
  qwen:     { acpArgs: ['--acp'] },
  opencode: { acpArgs: ['acp'] },
  gemini:   { acpArgs: ['--experimental-acp'] },
  claude:   { acpArgs: [], adapterCommand: 'claude-code-acp', adapterPackage: '@zed-industries/claude-code-acp', isAdapter: true },
  codex:    { acpArgs: [], adapterCommand: 'codex-acp', adapterPackage: '@zed-industries/codex-acp', isAdapter: true },
};

export function getAcpProfile(cli: CliId): AcpProfile | undefined {
  return ACP_PROFILES[cli];
}

export function supportsAcp(cli: CliId): boolean {
  return cli in ACP_PROFILES;
}

// ---- ACP adapter 状态检测与一键安装 ----

export interface AdapterStatus {
  cliId: CliId;              // 所属 CLI（claude / codex）
  adapterCommand: string;    // adapter 可执行文件名
  adapterPackage: string;    // npm 包名
  installed: boolean;        // 是否已安装
}

// 检测某个 adapter 是否安装（通过 which 查找可执行文件）
async function checkAdapterInstalled(adapterCommand: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where', [adapterCommand], { timeout: 6000, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

// 列出所有 adapter 状态（仅 adapter 类 CLI）
export async function listAdapterStatuses(): Promise<AdapterStatus[]> {
  const result: AdapterStatus[] = [];
  for (const [cli, profile] of Object.entries(ACP_PROFILES)) {
    if (!profile?.isAdapter || !profile.adapterCommand || !profile.adapterPackage) continue;
    const installed = await checkAdapterInstalled(profile.adapterCommand);
    result.push({
      cliId: cli as CliId,
      adapterCommand: profile.adapterCommand,
      adapterPackage: profile.adapterPackage,
      installed,
    });
  }
  return result;
}

// 安装 adapter：npm install -g <package>，流式回传输出
export function installAdapter(
  cliId: CliId,
  onData: (chunk: string) => void,
  timeoutMs = 300_000,
): Promise<{ code: number | null; error?: string }> {
  return new Promise((resolve) => {
    const profile = ACP_PROFILES[cliId];
    if (!profile?.adapterPackage) {
      resolve({ code: null, error: `no adapter package for ${cliId}` });
      return;
    }
    const pkg = profile.adapterPackage;
    const proc = spawn('npm', ['install', '-g', pkg], { shell: true, windowsHide: true });
    let settled = false;
    const done = (r: { code: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const feed = (d: Buffer) => onData(d.toString('utf8'));
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', (err) => done({ code: null, error: err.message }));
    proc.on('close', (code) => done({ code }));
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        done({ code: null, error: 'timeout' });
      }
    }, timeoutMs);
  });
}

interface PendingReq {
  method: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export interface AcpConfigOption {
  type: string;
  id: string;
  name: string;
  category: string;
  currentValue: string;
  options: Array<{ value: string; name: string }>;
}

export interface AcpCallbacks {
  onEvent: (ev: StreamEventPayload) => void;
  onClose: (reason?: string) => void;
  onPermissionRequest?: (req: PermissionRequestPayload) => void;
}

class AcpConnection {
  private proc: ChildProcess;
  private pendingPermissions = new Map<string, (optionId: string | null) => void>();
  private turnOnEvent: ((ev: StreamEventPayload) => void) | undefined;
  private ready = false; // handshake+session 建立前为 false：抑制 session/load 的历史回放
  private buf = '';
  private stdoutNonJson = ''; // stdout 中非 JSON-RPC 行：kimi 等 CLI 会在此输出 403/认证错误详情
  private stderrBuf = ''; // 累积 stderr：部分 CLI 在 stderr 输出原始 HTTP 错误
  private idSeq = 1;
  private pending = new Map<number, PendingReq>();
  private manualClose = false; // 主动 kill 时置 true：抑制 onClose 推送 error/system 事件，避免误导用户
  sessionId: string | null = null;
  lastEventAt = 0; // 最后收到事件的时间（判定是否仍在生成）
  configOptions: AcpConfigOption[] = [];
  /** 暴露 envExtra 快照，用于检测切换模型时是否需要重建连接 */
  readonly envSnapshot: string;
  /** 暴露 modelEntryId 快照，用于检测配置文件类 CLI 模型切换 */
  modelEntrySnapshot: string | undefined;

  constructor(
    private executable: string,
    private argsPrefix: string[],
    private acpArgs: string[],
    private cwd: string,
    private cb: AcpCallbacks,
    private envExtra: Record<string, string>,
    private taskIdKey: string = '',
  ) {
    this.envSnapshot = JSON.stringify(envExtra);
    this.proc = this.spawn();
  }

  /** 读取累积的非 JSON stdout + stderr（错误诊断用） */
  getDiagnosticOutput(): string {
    const stdout = this.stdoutNonJson.trim().slice(-1000);
    const stderr = this.stderrBuf.trim().slice(-1000);
    return [stdout, stderr].filter(Boolean).join('\n');
  }

  private spawn(): ChildProcess {
    const proc = spawn(this.executable, [...this.argsPrefix, ...this.acpArgs], {
      cwd: this.cwd,
      env: { ...(process.env as Record<string, string>), ...this.envExtra },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // 捕获 stderr：kimi/claude 等 CLI 会在 stderr 输出原始 HTTP 错误详情（403/401 等），
      // ACP JSON-RPC error.message 往往被包装成"模型不存在"，丢失原始信息
      this.stderrBuf += text;
      // 防止无限增长：保留最后 8KB
      if (this.stderrBuf.length > 8192) this.stderrBuf = this.stderrBuf.slice(-8192);

      // 主动检测 API 错误：kimi 遇到 API 错误（400/403/401/500）时，
      // 可能只在 stderr 输出错误详情，但 session/prompt 请求挂起不返回。
      // 检测到错误模式时主动 reject pending 请求，避免用户等 10 分钟超时
      const apiErrorMatch = text.match(/APIStatusError:\s*(\d{3})\s*(.+)/);
      const httpErrorMatch = text.match(/HTTP\s+Status\s+(\d{3})/) || text.match(/\b(4\d{2}|5\d{2})\b.*(?:error|Error|failed|denied|unauthorized|forbidden)/);
      const match = apiErrorMatch || httpErrorMatch;
      if (match) {
        const errMsg = this.stderrBuf.trim().slice(-1500);
        // reject 所有 pending 请求（主要是 session/prompt）
        for (const [id, p] of this.pending) {
          p.reject(new Error(errMsg.slice(0, 1000)));
          this.pending.delete(id);
        }
      }
    });
    proc.on('close', () => {
      // 关闭原因优先取 stdout 非 JSON 输出（含 403/认证错误详情），其次 stderr
      const stdoutTail = this.stdoutNonJson.trim().slice(-1000);
      const stderrTail = this.stderrBuf.trim().slice(-1000);
      const reason = stdoutTail || stderrTail || undefined;
      for (const p of this.pending.values()) {
        p.reject(new Error(reason ? `acp process closed: ${reason.slice(0, 500)}` : 'acp process closed'));
      }
      this.pending.clear();
      // 主动 kill（如 config.toml 变化需重建连接）时不推送 onClose，避免误导用户
      if (!this.manualClose) {
        this.cb.onClose(reason);
      }
    });
    proc.on('error', () => {
      /* close 事件会跟上 */
    });
    return proc;
  }

  private onData(chunk: Buffer) {
    this.buf += chunk.toString('utf8');
    const lines = this.buf.split(/\r?\n/);
    this.buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // 非 JSON 行：kimi/claude 等 CLI 会在 stdout 输出原始 HTTP 错误详情（403/401），
        // 这些信息不在 JSON-RPC error.message 里。累积以供错误诊断时拼接
        this.stdoutNonJson += line + '\n';
        if (this.stdoutNonJson.length > 8192) this.stdoutNonJson = this.stdoutNonJson.slice(-8192);
        continue;
      }
      this.onMessage(obj);
    }
  }

  private onMessage(obj: Record<string, unknown>) {
    this.lastEventAt = Date.now();
    acpLog('<<<', obj);
    // 响应
    if (obj.id !== undefined && (obj.result !== undefined || obj.error !== undefined)) {
      const req = this.pending.get(obj.id as number);
      if (req) {
        this.pending.delete(obj.id as number);
        if (obj.error) {
          const errObj = obj.error as { code?: number; message?: string; data?: unknown };
          const detail = errObj.data ? `\n[data] ${JSON.stringify(errObj.data).slice(0, 800)}` : '';
          // 拼接 stdout 非 JSON 输出 + stderr：ACP error.message 常被 CLI 包装成"模型不存在"，
          // 原始 HTTP 错误（403/401 详情）往往只在 stdout 非 JSON 行或 stderr 输出
          const stdoutTail = this.stdoutNonJson.trim().slice(-1000);
          const stderrTail = this.stderrBuf.trim().slice(-1000);
          const stdoutPart = stdoutTail ? `\n[stdout]\n${stdoutTail}` : '';
          const stderrPart = stderrTail ? `\n[stderr]\n${stderrTail}` : '';
          req.reject(new Error(`[${errObj.code ?? '?'}] ${errObj.message ?? 'unknown error'}${detail}${stdoutPart}${stderrPart}`));
        }
        else req.resolve(obj.result);
      }
      return;
    }
    // 通知：session/update
    if (obj.method === 'session/update') {
      if (!this.ready) return; // 回放期通知不进入渲染与持久化（防止历史重复输出）
      const params = obj.params as { update?: Record<string, unknown> };
      if (params?.update) {
        for (const ev of mapAcpUpdate(params.update)) {
          this.cb.onEvent(ev);
          this.turnOnEvent?.(ev);
        }
      }
    }
    // 权限审批反向请求（ACP session/request_permission）
    if (obj.method === 'session/request_permission' && obj.id !== undefined) {
      this.handlePermissionRequest(obj.id as number, obj.params as Record<string, unknown>);
      return;
    }
    // 其他反向请求（fs/terminal 等）：本客户端不支持，统一返回错误避免阻塞
    if (obj.method && obj.id !== undefined && obj.result === undefined) {
      this.writeRaw({
        jsonrpc: '2.0',
        id: obj.id,
        error: { code: -32601, message: 'method not found' },
      });
    }
  }

  // 权限请求：挂起 → 通知客户端 → 用户选择后回 JSON-RPC 响应
  private handlePermissionRequest(rpcId: number, params: Record<string, unknown>) {
    const toolCall = (params.toolCall ?? {}) as Record<string, unknown>;
    const options = (Array.isArray(params.options) ? params.options : []) as PermissionOption[];
    const requestId = `perm_${rpcId}`;
    const contentArr = Array.isArray(toolCall.content) ? toolCall.content : [];
    const toolName = String(toolCall.title ?? 'tool');
    const texts = contentArr
      .map((c: Record<string, unknown>) => {
        const inner = c.content as Record<string, unknown> | undefined;
        return typeof inner?.text === 'string' ? inner.text : '';
      })
      .filter(Boolean);
    // 方案选择类（ExitPlanMode 等）：第一个 content 是完整方案 markdown，保留全文
    const isPlan = /exitplanmode|askuserquestion/i.test(toolName);
    const summary = isPlan
      ? texts[texts.length - 1]?.slice(0, 300) ?? ''
      : texts.join(' ').slice(0, 300);
    const planContent = isPlan ? texts[0] : undefined;

    const payload: PermissionRequestPayload = {
      requestId,
      taskId: this.taskIdKey,
      toolName,
      summary,
      options,
      planContent,
    };
    this.cb.onPermissionRequest?.(payload);

    // 超时/断连兜底：自动 cancelled
    const timer = setTimeout(() => {
      this.resolvePermission(requestId, rpcId, null);
    }, 300_000);
    this.pendingPermissions.set(requestId, (optionId) => {
      clearTimeout(timer);
      this.resolvePermission(requestId, rpcId, optionId);
    });
  }

  private resolvePermission(requestId: string, rpcId: number, optionId: string | null) {
    if (!this.pendingPermissions.delete(requestId)) return;
    this.writeRaw({
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        outcome: optionId
          ? { outcome: 'selected', optionId }
          : { outcome: 'cancelled' },
      },
    });
  }

  respondPermission(requestId: string, optionId: string | null): boolean {
    const resolver = this.pendingPermissions.get(requestId);
    if (!resolver) return false;
    resolver(optionId);
    return true;
  }

  private writeRaw(msg: Record<string, unknown>) {
    acpLog('>>>', msg);
    this.proc.stdin?.write(JSON.stringify(msg) + '\n');
  }

  private request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.idSeq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (r: unknown) => void, reject });
      this.writeRaw({ jsonrpc: '2.0', id, method, params });
      // 不设超时：长任务可能跑很久，用户可随时点「停止」中断
    });
  }

  async handshake(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'ai-cli-hub', version: '0.1.0' },
    });
    await this.request('authenticate', { methodId: 'login' });
  }

  markReady() {
    this.ready = true;
  }

  async newSession(loadSessionId?: string): Promise<string> {
    if (loadSessionId) {
      try {
        const result = (await this.request('session/load', {
          sessionId: loadSessionId,
          cwd: this.cwd,
          mcpServers: [],
        })) as { sessionId?: string; configOptions?: AcpConfigOption[] };
        this.sessionId = result.sessionId ?? loadSessionId;
        this.configOptions = result.configOptions ?? [];
        return this.sessionId;
      } catch {
        /* load 失败则新建 */
      }
    }
    const result = (await this.request('session/new', {
      cwd: this.cwd,
      mcpServers: [],
    })) as { sessionId: string; configOptions?: AcpConfigOption[] };
    this.sessionId = result.sessionId;
    this.configOptions = result.configOptions ?? [];
    return this.sessionId;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.sessionId) return;
    // 不吞掉错误：模型/thinking 设置失败时抛异常，让上层 catch 向前端报错
    // 否则 ACP 会用默认模型连接自定义端点，导致更隐蔽的认证/模型不匹配错误
    const result = (await this.request('session/set_config_option', {
      sessionId: this.sessionId,
      configId,
      value,
    })) as { configOptions?: AcpConfigOption[] };
    if (result.configOptions) this.configOptions = result.configOptions;
  }

  setTurnOnEvent(cb: ((ev: StreamEventPayload) => void) | undefined) {
    this.turnOnEvent = cb;
  }

  async prompt(text: string, images?: Array<{ data: string; mimeType: string }>): Promise<void> {
    if (!this.sessionId) throw new Error('acp session not ready');
    // ACP promptCapabilities.image=true：image block = {type:'image', data(base64), mimeType}
    const prompt: Array<Record<string, unknown>> = (images ?? []).map((img) => ({
      type: 'image',
      data: img.data,
      mimeType: img.mimeType,
    }));
    prompt.push({ type: 'text', text });
    await this.request('session/prompt', { sessionId: this.sessionId, prompt });
  }

  // cancel 按 ACP 规范是 notification（无 id 不等响应）；kimi 0.26 未实现但收到也无害
  cancel(): void {
    if (!this.sessionId) return;
    try {
      this.writeRaw({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } });
    } catch {
      /* 忽略 */
    }
  }

  kill() {
    this.manualClose = true;
    this.proc.kill();
  }
}

// session/update → 统一事件流
export function mapAcpUpdate(update: Record<string, unknown>): StreamEventPayload[] {
  const type = update.sessionUpdate as string;
  const events: StreamEventPayload[] = [];

  if (type === 'agent_message_chunk' || type === 'agent_thought_chunk') {
    const content = update.content as { type?: string; text?: string };
    if (content?.text) {
      events.push({
        type: type === 'agent_message_chunk' ? 'delta' : 'thinking',
        text: content.text,
      });
    }
    return events;
  }

  if (type === 'tool_call' || type === 'tool_call_update') {
    const toolId = String(update.toolCallId ?? 'tool');
    const status = String(update.status ?? '');
    const title = String(update.title ?? 'tool');
    const contentText = extractContentText(update.content);
    if (status === 'completed' || status === 'failed') {
      events.push({
        type: 'tool_result',
        toolId,
        result: fixMojibake(contentText).slice(0, 4000),
        isError: status === 'failed',
      });
    } else {
      // pending / in_progress：新建或更新工具块（装配层按 toolId 去重）
      events.push({
        type: 'tool_call',
        toolId,
        name: title,
        args: contentText,
      });
    }
    return events;
  }

  if (type === 'plan') {
    // plan.entries: [{content, priority, status}] → 映射为 TodoList 工具（复用现有清单 UI）
    const entries = Array.isArray(update.entries) ? update.entries : [];
    const todos = entries.map((e: Record<string, unknown>) => ({
      title: String(e.content ?? e.title ?? ''),
      status: String(e.status ?? 'pending'),
    }));
    events.push({
      type: 'tool_call',
      toolId: 'acp-plan',
      name: 'TodoList',
      args: JSON.stringify({ todos }),
    });
    events.push({ type: 'tool_result', toolId: 'acp-plan', result: '', isError: false });
    return events;
  }

  // ACP agent 错误：某些 CLI 会通过 session/update 返回错误而非 JSON-RPC error
  if (type === 'error' || type === 'agent_error' || type === 'agent_error_chunk') {
    const message = String(
      update.message ?? update.error ?? update.text ?? 'ACP agent error',
    );
    events.push({ type: 'error', message });
    return events;
  }

  // 兜底：未知 session/update 类型但含错误信号（如 kimi 的 status=error 或自定义错误类型）
  // 避免遗漏 CLI 私有错误格式导致错误被吞掉
  const statusStr = String(update.status ?? '');
  if (statusStr === 'error' || statusStr === 'failed') {
    const message = String(
      update.message ?? update.error ?? update.text ?? update.detail ??
      (update.content as { text?: string })?.text ??
      `ACP ${type} ${statusStr}`,
    );
    events.push({ type: 'error', message });
    return events;
  }

  return events;
}

function extractContentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content as Array<Record<string, unknown>>) {
    if (item.type === 'content') {
      const inner = item.content as { type?: string; text?: string };
      if (inner?.text) parts.push(inner.text);
    } else if (typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

// ---------- 管理器：每任务一个长驻连接 ----------
export class AcpManager {
  private conns = new Map<string, AcpConnection>();
  private sender: WebContents | null = null;
  /** 审批通知回调（主进程注入系统通知） */
  onNotifyPermission?: (toolName: string, summary: string) => void;

  attach(sender: WebContents) {
    this.sender = sender;
  }

  isAlive(taskId: string): boolean {
    return this.conns.has(taskId);
  }

  getConfigOptions(taskId: string): AcpConfigOption[] {
    return this.conns.get(taskId)?.configOptions ?? [];
  }

  // 确保连接存在（崩溃/首次则重连）；storedSessionId 用于 session/load 恢复
  // modelEntryId 用于检测模型切换：CLI 进程启动时读取配置文件，运行中不重读，
  // 模型切换时必须杀旧连接重建，让新进程读取最新配置文件
  private async ensure(
    taskId: string,
    cli: CliId,
    executable: { file: string; argsPrefix: string[]; acpArgs: string[] },
    cwd: string,
    envExtra: Record<string, string>,
    storedSessionId?: string,
    modelEntryId?: string,
  ): Promise<AcpConnection> {
    const existing = this.conns.get(taskId);
    if (existing) {
      // 检测 envExtra 或 modelEntryId 是否变化（如切换了自定义模型）
      // env 在 spawn 时固定，无法中途更改；配置文件类 CLI 也需要重建进程重读配置
      const newSnapshot = JSON.stringify(envExtra);
      if (existing.envSnapshot === newSnapshot && existing.modelEntrySnapshot === modelEntryId) {
        return existing;
      }
      // env 或 modelEntryId 变化：杀旧连接，下面重建
      existing.kill();
      this.conns.delete(taskId);
      console.log(`[acp] env/model changed, reconnecting task=${taskId}`);
    }

    const conn = new AcpConnection(
      executable.file,
      executable.argsPrefix,
      executable.acpArgs,
      cwd,
      {
        // 仅负责推送渲染进程；持久化由各轮 prompt 的 setTurnOnEvent 携带（避免双投递）
        onEvent: (ev) => {
          safeSend(this.sender, 'task:event', { ...ev, taskId });
        },
        onClose: (reason) => {
          this.conns.delete(taskId);
          // 连接意外关闭：若有 stderr 原因（如 403/认证失败），作为 error 推送以便用户看到原始信息；
          // 否则只发 system 提示
          if (reason) {
            safeSend(this.sender, 'task:event', {
              type: 'error',
              message: `ACP 连接关闭：${reason.slice(0, 1000)}`,
              taskId,
            });
          } else {
            safeSend(this.sender, 'task:event', { type: 'system', text: '[acp connection closed]', taskId });
          }
        },
        onPermissionRequest: (req) => {
          safeSend(this.sender, 'permission:request', req);
          this.onNotifyPermission?.(req.toolName, req.summary);
        },
      },
      envExtra,
      taskId,
    );
    this.conns.set(taskId, conn);
    await conn.handshake();
    await conn.newSession(storedSessionId);
    conn.markReady(); // 回放结束，之后通知才放行
    conn.modelEntrySnapshot = modelEntryId; // 记录当前模型，供下次 ensure 检测变化
    return conn;
  }

  // 发送一条消息（流式事件经 onEvent + sender 推送）
  async prompt(
    taskId: string,
    cli: CliId,
    executable: { file: string; argsPrefix: string[]; acpArgs: string[] },
    cwd: string,
    text: string,
    opts: {
      images?: Array<{ data: string; mimeType: string }>;
      envExtra?: Record<string, string>;
      storedSessionId?: string;
      model?: string;
      effort?: string;
      permission?: string; // ACP mode：default/plan/auto/yolo
      modelEntryId?: string;
      onEvent?: (ev: StreamEventPayload) => void;
    },
  ): Promise<{ sessionId: string | null }> {
    const conn = await this.ensure(
      taskId, cli, executable, cwd, opts.envExtra ?? {}, opts.storedSessionId, opts.modelEntryId,
    );
    if (opts.model) await conn.setConfigOption('model', opts.model);
    if (opts.effort) await conn.setConfigOption('thinking', opts.effort === 'off' ? 'off' : 'on');
    if (opts.permission) {
      try {
        await conn.setConfigOption('mode', opts.permission);
      } catch {
        // 该 CLI 的 ACP 不支持此 mode 值时忽略，不影响发送
      }
    }

    // 统计本轮内容事件；kimi 在会话存在遗留未结束轮次时会立即 end_turn 空响应
    let contentEvents = 0;
    const counting = (ev: StreamEventPayload) => {
      if (ev.type === 'delta' || ev.type === 'thinking' || ev.type === 'tool_call') contentEvents++;
      opts.onEvent?.(ev);
    };
    conn.setTurnOnEvent(counting);
    await conn.prompt(text, opts.images);
    if (contentEvents === 0) {
      // 空轮：先尝试 cancel 清理可能卡住的轮次后重试（kimi 0.26 的 ACP 未实现 session/cancel，会报错，忽略）
      console.warn(`[acp] empty turn for task=${taskId}, cancel + retry once`);
      conn.cancel(); // notification，不等响应
      await conn.prompt(text, opts.images);
    }
    if (contentEvents === 0) {
      // 仍空轮：会话数据本身已损坏（实测 kimi 对中毒会话恒返回空 end_turn）——
      // 丢弃旧会话，用全新 session/new 重试（应用内消息历史不受影响）
      console.warn(`[acp] still empty after retry, resetting session task=${taskId}`);
      conn.kill();
      this.conns.delete(taskId);
      const fresh = await this.ensure(
        taskId, cli, executable, cwd, opts.envExtra ?? {}, undefined, opts.modelEntryId,
      );
      fresh.setTurnOnEvent(counting);
      if (opts.model) await fresh.setConfigOption('model', opts.model);
      if (opts.effort) await fresh.setConfigOption('thinking', opts.effort === 'off' ? 'off' : 'on');
      if (opts.permission) {
        try {
          await fresh.setConfigOption('mode', opts.permission);
        } catch {
          // ignore
        }
      }
      opts.onEvent?.({ type: 'system', text: '旧会话无响应，已自动重置为新会话', taskId } as StreamEventPayload);
      await fresh.prompt(text, opts.images);
      fresh.setTurnOnEvent(undefined);
      return { sessionId: fresh.sessionId };
    }
    conn.setTurnOnEvent(undefined);
    return { sessionId: conn.sessionId };
  }

  respondPermission(requestId: string, optionId: string | null): boolean {
    for (const conn of this.conns.values()) {
      if (conn.respondPermission(requestId, optionId)) return true;
    }
    return false;
  }

  // 停止：先发 cancel（0.34 已支持优雅取消），同时兜底 kill（0.26 等老版本未实现 cancel）
  // cancel 后 kimi 返回 stopReason=cancelled；若进程仍在（老版本无 cancel）则 kill
  async stop(taskId: string): Promise<void> {
    const conn = this.conns.get(taskId);
    if (!conn) return;
    conn.cancel();
    // 优雅 cancel 窗口：若 1.5s 后仍有事件活动（老版本 cancel 无效）→ kill 兜底
    setTimeout(() => {
      if (this.conns.get(taskId) === conn && Date.now() - conn.lastEventAt < 1200) {
        this.kill(taskId);
      }
    }, 1500);
  }

  // 对已建立的长驻连接实时设置 config option（如权限模式 mode），无连接时静默跳过
  async setSessionOption(taskId: string, configId: string, value: string): Promise<void> {
    const conn = this.conns.get(taskId);
    if (!conn) return;
    try {
      await conn.setConfigOption(configId, value);
    } catch {
      // 不支持该 option 时忽略
    }
  }

  kill(taskId: string): void {
    const conn = this.conns.get(taskId);
    if (conn) {
      conn.kill();
      this.conns.delete(taskId);
    }
  }

  killAll(): void {
    for (const conn of this.conns.values()) conn.kill();
    this.conns.clear();
  }

  // 是否有任意 ACP 连接正在进行（用于关闭前判断是否需要弹窗确认）
  hasRunning(): boolean {
    return this.conns.size > 0;
  }
}
