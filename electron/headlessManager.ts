// headless 调用管理：按任务线程 spawn 各 CLI 的非交互模式，
// 逐行解析 stdout 的 stream-json（JSONL），转成结构化事件推给渲染进程。
import { spawn, type ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import type { CliId, StreamEvent, StreamEventPayload, AppSettings } from './shared';
import { fixMojibake } from './mojibake';
import { safeSend } from './safeSend';

export interface RunContext {
  taskId: string;
  cli: CliId;
  cwd: string;
  message: string;
  sessionId?: string; // 续轮会话 id
  sender: WebContents | null;
  onEvent?: (ev: StreamEventPayload) => void; // 主进程内部消费（持久化等）
  envExtra?: Record<string, string>; // 注入子进程的额外环境变量（如应用内 API key）
  textMode?: boolean; // kimi text 模式：stdout=正文(transcript 风格)，stderr=thinking
  // 控制请求（claude can_use_tool 审批）：主进程注入，写 stdin 回应
  onControlRequest?: (req: { requestId: string; toolName: string; summary: string; rawInput: Record<string, unknown> }) => void;
  extraArgs?: string[]; // 追加的命令行参数（如 --model）
}

interface CliHeadlessAdapter {
  // 组装命令行参数（不含可执行文件本身）；opts.textMode 仅 kimi 使用
  buildArgs: (message: string, sessionId?: string, opts?: { textMode?: boolean }) => string[];
  // 解析一行 JSONL，产出 0..n 个事件（不含 taskId，由外层补）
  parseLine: (line: string) => Array<StreamEventPayload>;
}

const isWin = process.platform === 'win32';

// ---------- kimi ----------
// 首轮:  kimi -p "<msg>" --output-format stream-json
// 续轮:  kimi -r <sessionId> -p "<msg>" --output-format stream-json
// JSONL: {"role":"assistant","content":"..."} / {"role":"tool",...} / {"role":"meta","type":"session.resume_hint","session_id":...}
const kimiAdapter: CliHeadlessAdapter = {
  buildArgs: (message, sessionId, opts) => {
    const args: string[] = [];
    if (sessionId) args.push('-r', sessionId);
    // text 模式：thinking/tool progress 走 stderr（官方文档），思考开关开启时使用
    args.push('-p', message, '--output-format', opts?.textMode ? 'text' : 'stream-json');
    return args;
  },
  parseLine: (line) => {
    const obj = safeJson(line);
    if (!obj) return [];
    // 会话 id 提示
    if (obj.role === 'meta' && obj.type === 'session.resume_hint' && typeof obj.session_id === 'string') {
      return [{ type: 'session', cli: 'kimi', sessionId: obj.session_id }];
    }
    if (obj.role === 'assistant') {
      const events: StreamEventPayload[] = [];
      // content 与 tool_calls 可能同现于一行（实测），两个都要发，否则会丢工具卡片
      if (typeof obj.content === 'string' && obj.content) {
        events.push({ type: 'delta', text: obj.content });
      }
      const calls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
      for (const [i, c] of (calls as Record<string, unknown>[]).entries()) {
        events.push({
          type: 'tool_call' as const,
          toolId: String(c.id ?? `kimi-tool-${i}`),
          name: String((c.function as Record<string, unknown>)?.name ?? c.name ?? 'tool'),
          args: String((c.function as Record<string, unknown>)?.arguments ?? c.arguments ?? ''),
        });
      }
      return events;
    }
    if (obj.role === 'tool') {
      return [{
        type: 'tool_result',
        toolId: String(obj.tool_call_id ?? obj.name ?? 'tool'),
        result: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content ?? ''),
      }];
    }
    return [];
  },
};

// ---------- claude ----------
// 首轮:  claude -p "<msg>" --output-format stream-json --verbose
// 续轮:  claude -p "<msg>" --output-format stream-json --verbose --resume <sessionId>
// JSONL: system.init / assistant(message.content[]) / user(tool_result) / result
const claudeAdapter: CliHeadlessAdapter = {
  buildArgs: (message, sessionId) => {
    // 双向 stream-json：消息经 stdin 写入（-p 带消息 + input-format 会挂起等待），
    // --permission-prompt-tool stdio 让审批以 control_request 走 stdout（否则 default 模式直接拒绝）
    const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio'];
    if (sessionId) args.push('--resume', sessionId);
    return args;
  },
  parseLine: (line) => {
    const obj = safeJson(line);
    if (!obj) return [];
    const events: Array<StreamEventPayload> = [];
    // token 级流式增量（--include-partial-messages）
    if (obj.type === 'stream_event' && obj.event) {
      const event = obj.event as Record<string, unknown>;
      if (event.type === 'content_block_delta' && event.delta) {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
          events.push({ type: 'delta', text: delta.text });
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
          events.push({ type: 'thinking', text: delta.thinking });
        }
      }
      return events;
    }
    if (obj.type === 'system' && obj.subtype === 'init' && typeof obj.session_id === 'string') {
      events.push({ type: 'session', cli: 'claude', sessionId: obj.session_id });
    }
    if (obj.type === 'assistant' && obj.message) {
      const content = (obj.message as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            events.push({ type: 'delta', text: block.text });
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
            events.push({ type: 'thinking', text: block.thinking });
          } else if (block.type === 'tool_use') {
            events.push({
              type: 'tool_call',
              toolId: String(block.id ?? `claude-tool`),
              name: String(block.name ?? 'tool'),
              args: JSON.stringify(block.input ?? {}),
            });
          }
        }
      }
    }
    if (obj.type === 'user' && obj.message) {
      const content = (obj.message as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'tool_result') {
            const text = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content ?? '');
            events.push({
              type: 'tool_result',
              toolId: String(block.tool_use_id ?? 'tool'),
              result: text,
              isError: block.is_error === true,
            });
          }
        }
      }
    }
    if (obj.type === 'result') {
      // 真实 token 用量（实测字段：usage.input_tokens / output_tokens / cache_*）
      const usage = obj.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
      if (usage && (usage.input_tokens || usage.output_tokens)) {
        events.push({
          type: 'usage',
          inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens ?? 0,
          estimated: false,
        });
      }
      if (obj.is_error === true && typeof obj.result === 'string' && obj.result) {
        events.push({ type: 'error', message: obj.result });
      }
      events.push({ type: 'done' });
    }
    return events;
  },
};

// ---------- gemini（未安装，按公开无头用法实现，允许误差）----------
// gemini -p "<msg>" --output-format json （一次性 JSON，无流式）
const geminiAdapter: CliHeadlessAdapter = {
  buildArgs: (message) => ['-p', message, '--output-format', 'json'],
  parseLine: (line) => {
    const obj = safeJson(line);
    if (!obj) return [];
    if (typeof obj.response === 'string' && obj.response) {
      return [{ type: 'delta', text: obj.response }, { type: 'done' }];
    }
    if (typeof obj.session_id === 'string') {
      return [{ type: 'session', cli: 'gemini', sessionId: obj.session_id }];
    }
    return [];
  },
};

// ---------- codex（未安装，按 codex exec --json 实现，允许误差）----------
const codexAdapter: CliHeadlessAdapter = {
  buildArgs: (message) => ['exec', message, '--json', '--skip-git-repo-check'],
  parseLine: (line) => {
    const obj = safeJson(line);
    if (!obj) return [];
    // codex exec --json 输出 item 事件流
    const item = obj.item as Record<string, unknown> | undefined;
    if (obj.type === 'item.completed' && item) {
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        return [{ type: 'delta', text: item.text }];
      }
      if (item.type === 'command_execution') {
        return [{
          type: 'tool_call',
          toolId: String(item.id ?? 'codex-tool'),
          name: 'command_execution',
          args: String(item.command ?? ''),
        }];
      }
    }
    if (obj.type === 'turn.completed') return [{ type: 'done' }];
    if (obj.type === 'thread.started' && typeof obj.thread_id === 'string') {
      return [{ type: 'session', cli: 'codex', sessionId: obj.thread_id }];
    }
    return [];
  },
};

// ---------- qwen / opencode / aider（按公开无头用法实现，未实测）----------
// qwen：gemini-cli 的 fork，-p + json 输出，复用 gemini 解析
const qwenAdapter: CliHeadlessAdapter = {
  buildArgs: (message) => ['-p', message, '--output-format', 'json'],
  parseLine: geminiAdapter.parseLine,
};

// 纯文本适配器工厂：无结构化输出的 CLI，每个非空 stdout 行作为 delta
function makeTextAdapter(buildArgs: (message: string) => string[]): CliHeadlessAdapter {
  return {
    buildArgs,
    parseLine: (line) => {
      const text = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trimEnd();
      return text.trim() ? [{ type: 'delta', text: text + '\n' }] : [];
    },
  };
}

// opencode：opencode run "<msg>"
const opencodeAdapter = makeTextAdapter((message) => ['run', message]);

// aider：aider --message "<msg>" --yes-always
const aiderAdapter = makeTextAdapter((message) => ['--message', message, '--yes-always']);

// hermes：hermes run "<msg>"（纯文本输出，无结构化 JSON 协议）
const hermesAdapter = makeTextAdapter((message) => ['run', message]);

// ---------- pi（极简开源 coding agent，支持 15+ 模型提供商）----------
// pi -p "<msg>" --output-format json
const piAdapter: CliHeadlessAdapter = {
  buildArgs: (message) => ['-p', message, '--output-format', 'json'],
  parseLine: (line) => {
    const obj = safeJson(line);
    if (!obj) return [];
    const events: Array<StreamEventPayload> = [];
    
    // Pi 的 JSON 输出格式（基于调研和文档）
    // 文本增量
    if (obj.type === 'text' && typeof obj.text === 'string' && obj.text) {
      events.push({ type: 'delta', text: obj.text });
    }
    // 工具调用
    else if (obj.type === 'tool_use' || obj.type === 'tool_call') {
      events.push({
        type: 'tool_call',
        toolId: String(obj.id ?? obj.tool_id ?? `pi-tool-${Date.now()}`),
        name: String(obj.name ?? 'tool'),
        args: typeof obj.input === 'string' ? obj.input : JSON.stringify(obj.input ?? {}),
      });
    }
    // 工具结果
    else if (obj.type === 'tool_result') {
      events.push({
        type: 'tool_result',
        toolId: String(obj.tool_use_id ?? obj.tool_id ?? 'tool'),
        result: typeof obj.output === 'string' ? obj.output : JSON.stringify(obj.output ?? ''),
        isError: obj.is_error === true,
      });
    }
    // 会话 ID
    else if (obj.type === 'session' && typeof obj.session_id === 'string') {
      events.push({ type: 'session', cli: 'pi', sessionId: obj.session_id });
    }
    // 完成标志
    else if (obj.type === 'done' || obj.type === 'complete') {
      events.push({ type: 'done' });
    }
    // 错误
    else if (obj.type === 'error' && typeof obj.message === 'string') {
      events.push({ type: 'error', message: obj.message });
    }
    
    return events;
  },
};

export const HEADLESS_ADAPTERS: Record<CliId, CliHeadlessAdapter> = {
  kimi: kimiAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  qwen: qwenAdapter,
  opencode: opencodeAdapter,
  aider: aiderAdapter,
  pi: piAdapter,
  hermes: hermesAdapter,
};

// kimi text 模式 stdout：transcript 风格，「• 」开头的段落行与两空格缩进的延续行
export function parseKimiTextStdout(line: string): StreamEventPayload[] {
  if (line.startsWith('• ')) return [{ type: 'delta', text: line.slice(2) + '\n\n' }];
  if (line.startsWith('  ')) return [{ type: 'delta', text: line.trimEnd().replace(/^  /, '') + '\n' }];
  if (!line.trim()) return [{ type: 'delta', text: '\n' }];
  return [{ type: 'delta', text: line + '\n' }];
}

// kimi text 模式 stderr：thinking（• 前缀）+ 会话恢复提示行
export function parseKimiTextStderr(line: string): StreamEventPayload[] {
  const resume = line.match(/To resume this session: kimi -r (\S+)/);
  if (resume) return [{ type: 'session', cli: 'kimi', sessionId: resume[1] }];
  if (line.startsWith('• ')) return [{ type: 'thinking', text: line.slice(2) + '\n' }];
  if (line.trim()) return [{ type: 'thinking', text: line + '\n' }];
  return [];
}

function safeJson(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- 运行管理 ----------
export class HeadlessManager {
  private running = new Map<string, ChildProcess>();

  // 以无头模式向 CLI 发送一条消息，事件经 sender 推送；返回的 Promise 在进程退出时 resolve
  run(ctx: RunContext, executable: { file: string; argsPrefix: string[] }): Promise<void> {
    const adapter = HEADLESS_ADAPTERS[ctx.cli];
    const args = [
      ...executable.argsPrefix,
      ...adapter.buildArgs(ctx.message, ctx.sessionId, { textMode: ctx.textMode }),
      ...(ctx.extraArgs ?? []),
    ];

    return new Promise<void>((resolve) => {
    const proc = spawn(executable.file, args, {
      cwd: ctx.cwd,
      // 应用内 key 等额外 env 优先级高于进程环境变量
      env: { ...(process.env as Record<string, string>), ...(ctx.envExtra ?? {}) },
      windowsHide: true,
      // claude 双向协议需要 stdin pipe（写消息帧与审批回应）；其他 CLI 置空防挂起
      stdio: ctx.cli === 'claude' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    this.running.set(ctx.taskId, proc);

    // claude：消息经 stdin 写入（user 消息帧）
    if (ctx.cli === 'claude' && proc.stdin) {
      proc.stdin.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: ctx.message }] },
      }) + '\n');
    }

    let doneEmitted = false;
    const emit = (raw: StreamEventPayload) => {
      if (raw.type === 'done') {
        if (doneEmitted) return; // done 只发一次
        doneEmitted = true;
      }
      // Windows GBK 输出乱码的保守修复（仅 tool_result 文本）
      const ev: StreamEventPayload =
        raw.type === 'tool_result' ? { ...raw, result: fixMojibake(raw.result) } : raw;
      safeSend(ctx.sender, 'task:event', { ...ev, taskId: ctx.taskId });
      ctx.onEvent?.(ev);
    };

    let buffer = '';
    let gotDone = false;
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (ctx.textMode) {
          for (const ev of parseKimiTextStdout(line)) emit(ev);
          continue;
        }
        if (!line.trim()) continue;
        // claude 控制请求（审批）：不进事件流，走 onControlRequest
        if (ctx.cli === 'claude') {
          const ctrl = safeJson(line);
          if (ctrl?.type === 'control_request' && ctrl.request_id) {
            const req = (ctrl.request ?? {}) as Record<string, unknown>;
            const input = (req.input ?? {}) as Record<string, unknown>;
            const summary = String(req.description ?? input.file_path ?? input.command ?? input.path ?? '').slice(0, 300);
            ctx.onControlRequest?.({
              requestId: String(ctrl.request_id),
              toolName: String(req.tool_name ?? 'tool'),
              summary,
              rawInput: input,
            });
            continue;
          }
        }
        for (const ev of adapter.parseLine(line)) {
          if (ev.type === 'done') gotDone = true;
          emit(ev);
        }
      }
    });

    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      if (ctx.textMode) {
        // text 模式：stderr 逐行解析 thinking 与会话恢复提示
        const parts = stderrBuf.split(/\r?\n/);
        stderrBuf = parts.pop() ?? '';
        for (const line of parts) {
          for (const ev of parseKimiTextStderr(line)) emit(ev);
        }
      }
    });

    proc.on('error', (err) => {
      this.running.delete(ctx.taskId);
      emit({ type: 'error', message: err.message });
      emit({ type: 'done' });
      resolve();
    });

    proc.on('close', (code) => {
      this.running.delete(ctx.taskId);
      // 解析缓冲区残留
      if (buffer.trim()) {
        for (const ev of adapter.parseLine(buffer)) emit(ev);
      }
      if (ctx.textMode && stderrBuf.trim()) {
        for (const ev of parseKimiTextStderr(stderrBuf)) emit(ev);
      } else if (code !== 0 && stderrBuf.trim()) {
        emit({ type: 'error', message: stderrBuf.trim().slice(0, 2000) });
      }
      emit({ type: 'done' }); // emit 内部去重
      resolve();
    });
    });
  }

  stop(taskId: string): void {
    const proc = this.running.get(taskId);
    if (proc) {
      proc.kill();
      this.running.delete(taskId);
    }
  }

  // 暴露运行中进程（claude 审批回写 stdin 用）
  getProc(taskId: string): import('child_process').ChildProcess {
    const proc = this.running.get(taskId);
    if (!proc) throw new Error('process not running: ' + taskId);
    return proc;
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  // 是否有任意任务正在运行（用于关闭前判断是否需要弹窗确认）
  hasRunning(): boolean {
    return this.running.size > 0;
  }

  stopAll(): void {
    for (const proc of this.running.values()) proc.kill();
    this.running.clear();
  }
}

// 把检测到的可执行路径转成 spawn 目标（Windows 的 .cmd/.bat 经 cmd.exe /c）
export function toSpawnTarget(resolvedPath: string): { file: string; argsPrefix: string[] } {
  if (isWin && /\.(cmd|bat)$/i.test(resolvedPath)) {
    return { file: process.env.ComSpec || 'cmd.exe', argsPrefix: ['/c', resolvedPath] };
  }
  return { file: resolvedPath, argsPrefix: [] };
}
