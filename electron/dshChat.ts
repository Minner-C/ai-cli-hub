// dsh 对话通道：直连 dsh web 的 /api（unary RPC）+ /api/events.mux（WebSocket 事件流）
// 协议（逆向自 @deepseek-ai/dsh-client-connection）：
//   RPC:  POST /api/<method>  body {type:'client-request', rpcId, method, payload}
//         响应 {type:'server-response', rpcId, result:{ok, value|error}}
//   事件: WS /api/events.mux → 帧 {type:'server-request', method, payload}
//         method 'session/event' 的 payload.event 为会话事件流
import WebSocket from 'ws';
import type { WebContents } from 'electron';
import { ensureDshWeb } from './dshService';
import { safeSend } from './safeSend';
import { DSH_PERMISSION_PRESETS } from './permissionManager';
import type { EffortLevel, PermissionMode, StreamEventPayload } from './shared';

const BASE = 'http://127.0.0.1:3080';

interface RpcResult {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string };
}

// ---- unary RPC ----
async function rpc(method: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
  });
  if (!res.ok) throw new Error(`dsh ${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: RpcResult };
  const r = body.result;
  if (!r) throw new Error(`dsh ${method}: 响应缺 result`);
  if (!r.ok) throw new Error(r.error?.message ?? `dsh ${method} 失败 (${r.error?.code ?? 'unknown'})`);
  return r.value;
}

// ---- mux 事件流（全会话共享一条 WS）----
type EventHandler = (event: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let wsReady: Promise<void> | null = null;
const handlers = new Map<string, Set<EventHandler>>(); // sessionId → handlers

function dispatch(frame: Record<string, unknown>): void {
  if (frame.type !== 'server-request') return;
  const p = frame.payload as Record<string, unknown> | undefined;
  if (!p || p.type !== 'session/event') return;
  const sid = p.sessionId as string;
  const set = handlers.get(sid);
  if (!set) return;
  for (const h of set) h(p.event as Record<string, unknown>);
}

function ensureMux(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const sock = new WebSocket('ws://127.0.0.1:3080/api/events.mux');
    ws = sock;
    sock.on('open', () => resolve());
    sock.on('message', (data) => {
      try {
        dispatch(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        // 单帧损坏不致命，丢弃
      }
    });
    sock.on('error', (err) => {
      if (wsReady) { wsReady = null; reject(err); }
    });
    sock.on('close', () => {
      ws = null;
      wsReady = null;
      // 连接断开：通知所有挂起会话的处理器（以系统事件形式收尾由各 prompt 超时兜底）
    });
  });
  return wsReady;
}

function subscribe(sessionId: string, h: EventHandler): () => void {
  let set = handlers.get(sessionId);
  if (!set) handlers.set(sessionId, (set = new Set()));
  set.add(h);
  return () => {
    set.delete(h);
    if (set.size === 0) handlers.delete(sessionId);
  };
}

// ---- 事件映射：dsh session/event → 统一 StreamEventPayload ----
// 返回 true 表示本轮已结束（turn/end）。导出供单测直接锁定映射。
export function mapEvent(event: Record<string, unknown>, emit: (ev: StreamEventPayload) => void): boolean {
  const type = event.type as string;
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'assistant/chunk': {
      const chunk = (data.chunk ?? {}) as Record<string, unknown>;
      if (chunk.type === 'text-delta') emit({ type: 'delta', text: String(chunk.text ?? '') });
      else if (chunk.type === 'reasoning-delta') emit({ type: 'thinking', text: String(chunk.text ?? '') });
      else if (chunk.type === 'usage') {
        const u = (chunk.usage ?? {}) as Record<string, unknown>;
        emit({
          type: 'usage',
          inputTokens: Number(u.inputTokens ?? 0) + Number(u.cacheReadTokens ?? 0),
          outputTokens: Number(u.outputTokens ?? 0),
          estimated: false,
        });
      } else if (chunk.type === 'finish') {
        const reason = (chunk.reason ?? {}) as Record<string, unknown>;
        if (reason.kind === 'error') {
          const failure = (reason.failure ?? {}) as Record<string, unknown>;
          emit({ type: 'error', message: String(failure.message ?? '模型调用失败') });
        }
      }
      return false;
    }
    case 'tool/call':
      emit({
        type: 'tool_call',
        toolId: String(data.callId ?? `dsh-${Date.now()}`),
        name: String(data.name ?? 'tool'),
        args: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
      });
      return false;
    case 'tool/result': {
      const msg = (data.message ?? {}) as Record<string, unknown>;
      const callId = String(msg.callId ?? msg.toolCallId ?? '');
      const isError = Boolean(msg.isError);
      emit({ type: 'tool_result', toolId: callId, result: extractText(msg.content), isError });
      return false;
    }
    case 'turn/end': {
      const reason = (data.reason ?? {}) as Record<string, unknown>;
      if (reason.kind === 'error') {
        const err = (reason.error ?? {}) as Record<string, unknown>;
        emit({ type: 'error', message: String(err.message ?? '本轮出错') });
      }
      return true;
    }
    default:
      return false; // step/start、step/end、user/message、agent/* 等忽略
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  if (content == null) return '';
  const s = JSON.stringify(content);
  return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
}

// ---- 会话管理 ----
async function ensureSession(cwd: string, stored?: string): Promise<string> {
  if (stored) {
    try {
      const list = (await rpc('session.list', {})) as { items?: Array<{ sessionId: string }> };
      if (list.items?.some((i) => i.sessionId === stored)) return stored;
    } catch {
      // 列不出来就重建
    }
  }
  const created = (await rpc('session.create', { cwd })) as { sessionId: string };
  return created.sessionId;
}

// 同步应用内保存的 DEEPSEEK_API_KEY 到 dsh 凭证服务（dsh 自身不读应用配置）
export async function syncKey(key: string | null): Promise<void> {
  const up = await ensureDshWeb();
  if (!up.ok) return;
  if (key) await rpc('credentials.set', { ref: 'DEEPSEEK_API_KEY', value: key });
  else await rpc('credentials.unset', { ref: 'DEEPSEEK_API_KEY' }).catch(() => undefined);
}

export interface DshPromptOptions {
  cwd: string;
  text: string;
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  sessionId?: string;
  model?: string;         // 任务级模型（deepseek-v4-flash / deepseek-v4-pro）
  effort?: EffortLevel;   // 思考档位（dsh 实测支持 off/high/max）
  permission?: PermissionMode; // 权限模式（/permission preset 切换）
  planMode?: boolean;     // 计划模式（/plan、/plan off 切换）
  sender: WebContents | null;
  onEvent: (ev: StreamEventPayload) => void;
}

// ---- 会话控制：模型/思考/权限/plan（每会话记录已应用状态，只在变化时下发命令，避免命令事件噪音）----
const appliedControls = new Map<string, { preset?: string; plan?: boolean }>();

interface SessionModelsValue {
  current?: { provider: string; model: string; reasoningEffort?: string };
}

async function execSlashCommand(sessionId: string, line: string): Promise<void> {
  // commands/execute 的 payload 约定与其他端点不同：必须包一层 args（agentId=sessionId）
  const v = (await rpc('commands/execute', { args: { agentId: sessionId, line } })) as {
    result?: { kind: string; text?: string };
  };
  if (v.result?.kind === 'error') throw new Error(v.result.text ?? `${line} 失败`);
}

export async function applySessionControls(
  sessionId: string,
  opts: { model?: string; effort?: EffortLevel; permission?: PermissionMode; planMode?: boolean },
): Promise<void> {
  // 模型 + 思考档位：selectModel 合并下发（缺省项取当前会话值）
  if (opts.model || opts.effort) {
    // 档位钳制：dsh 仅 off/high/max（任务从其他 CLI 切换来可能带 low/medium，就近归入 high）
    const effort = opts.effort
      ? opts.effort === 'off' || opts.effort === 'max'
        ? opts.effort
        : 'high'
      : undefined;
    const cur = (await rpc('session.models', { sessionId })) as SessionModelsValue;
    await rpc('session.selectModel', {
      sessionId,
      provider: cur.current?.provider ?? 'deepseek-official',
      model: opts.model ?? cur.current?.model ?? 'deepseek-v4-flash',
      reasoningEffort: effort ?? cur.current?.reasoningEffort,
    });
  }
  const st = appliedControls.get(sessionId) ?? {};
  // 权限 preset：/permission <preset>（default/auto/plan → workspace-write；yolo → danger-full-access）
  if (opts.permission) {
    const preset = DSH_PERMISSION_PRESETS[opts.permission];
    if (preset && st.preset !== preset) {
      await execSlashCommand(sessionId, `/permission ${preset}`);
      st.preset = preset;
    }
  }
  // 计划模式：/plan 进入、/plan off 退出（只在状态变化时下发——/plan 可能是切换语义，重复发会来回翻）
  if (opts.planMode !== undefined && st.plan !== opts.planMode) {
    await execSlashCommand(sessionId, opts.planMode ? '/plan' : '/plan off');
    st.plan = opts.planMode;
  }
  appliedControls.set(sessionId, st);
}

// 发一轮对话：确保 dsh web 在跑 → 确保会话 → 订阅事件 → prompt → 等 turn/end
export async function prompt(taskId: string, opts: DshPromptOptions): Promise<{ sessionId: string }> {
  const up = await ensureDshWeb();
  if (!up.ok) throw new Error(up.message ?? 'dsh web 未就绪');
  const sessionId = await ensureSession(opts.cwd, opts.sessionId);
  opts.onEvent({ type: 'session', cli: 'dsh', sessionId });
  // 下发模型/思考/权限/plan（失败不阻断对话，记系统事件提示）
  try {
    await applySessionControls(sessionId, {
      model: opts.model,
      effort: opts.effort,
      permission: opts.permission,
      planMode: opts.planMode,
    });
  } catch (err) {
    const msg = `会话控制下发失败: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[dsh]', msg);
    safeSend(opts.sender, 'task:event', { type: 'system', text: msg, taskId });
    opts.onEvent({ type: 'system', text: msg });
  }
  await ensureMux();

  const content: Array<Record<string, unknown>> = [];
  if (opts.text) content.push({ type: 'text', text: opts.text });
  for (const img of opts.images ?? []) {
    content.push({ type: 'image', mediaType: img.mimeType, data: img.data, name: img.name });
  }

  const turnDone = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('dsh 本轮响应超时（10 分钟）')), 600_000);
    let lastError: string | null = null; // finish chunk 与 turn/end 会重复同一错误，去重
    const unsub = subscribe(sessionId, (event) => {
      let ended = false;
      try {
        ended = mapEvent(event, (ev) => {
          if (ev.type === 'error') {
            if (ev.message === lastError) return;
            lastError = ev.message;
          }
          safeSend(opts.sender, 'task:event', { ...ev, taskId });
          opts.onEvent(ev);
        });
      } catch {
        return;
      }
      if (ended) {
        clearTimeout(timeout);
        unsub();
        resolve();
      }
    });
  });

  try {
    await rpc('session.prompt', { sessionId, mode: 'queue', content });
  } catch (err) {
    // prompt 未被接受（如会话失效）：直接抛出让上层走 error+done
    throw err;
  }
  await turnDone;
  return { sessionId };
}

// 取消指定会话当前轮（task:stop 用）
export async function cancel(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    await rpc('session.cancel', { sessionId });
  } catch {
    // 幂等取消，失败忽略
  }
}

export function stopAll(): void {
  ws?.close();
  ws = null;
  wsReady = null;
  handlers.clear();
  appliedControls.clear();
}
