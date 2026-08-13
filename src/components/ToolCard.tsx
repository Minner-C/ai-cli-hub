// 工具调用卡片（TRAE 风格）：扁平一行摘要（状态圆点图标 + 摘要 + 右侧箭头），
// 点击展开详情（diff / 终端 / 文件高亮，容器无边框极简）
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import hljs from 'highlight.js';
import { Check, X, Loader2, ChevronRight, ChevronDown, Circle, CircleDot } from 'lucide-react';
import { computeLineDiff, collapseContext, type DiffLine } from '../utils/diffUtil';
import { useHubStore } from '../store';
import type { ChatMessage } from '../../electron/shared';
import { cleanDisplayText } from '../utils/displayText';
import SmartImage, { isImagePath } from './SmartImage';
import { toolDisplayName } from '../utils/toolNames';

// ---- 工具参数解析 ----
function parseArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function argPath(args: Record<string, unknown>): string {
  return String(args.file_path ?? args.path ?? args.filename ?? args.pattern ?? args.command ?? '');
}

function extOf(p: string): string {
  const m = p.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : '';
}

// 摘要：文件类工具取文件名，Bash 取命令首行
function summaryOf(name: string, args: Record<string, unknown>): { target: string; rest: string } {
  const raw = argPath(args);
  if (/^(bash|shell|run|command_execution)$/i.test(name)) {
    const first = String(args.command ?? raw).split('\n')[0];
    return { target: first.length > 60 ? first.slice(0, 60) + '…' : first, rest: '' };
  }
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return { target: base, rest: raw !== base ? raw : '' };
}

// ---- 语法高亮 ----
function HighlightedCode({ code, ext, maxLines = 60 }: { code: string; ext?: string; maxLines?: number }) {
  const html = useMemo(() => {
    const truncated = code.split('\n').slice(0, maxLines).join('\n');
    try {
      if (ext && hljs.getLanguage(ext)) return hljs.highlight(truncated, { language: ext }).value;
      return hljs.highlightAuto(truncated).value;
    } catch {
      return truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }
  }, [code, ext, maxLines]);
  const total = code.split('\n').length;
  return (
    <div className="code-with-lines">
      <pre>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {total > maxLines && <div className="hint">… {total - maxLines} more lines</div>}
    </div>
  );
}

// ---- diff 渲染 ----
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => collapseContext(computeLineDiff(oldText, newText)), [oldText, newText]);
  return (
    <pre className="diff-view">
      {rows.map((row, i) =>
        row.type === 'fold' ? (
          <div key={i} className="diff-fold">⋮ {row.count}</div>
        ) : (
          <div key={i} className={`diff-line diff-${(row as DiffLine).type}`}>
            <span className="diff-sign">
              {(row as DiffLine).type === 'add' ? '+' : (row as DiffLine).type === 'del' ? '-' : ' '}
            </span>
            {(row as DiffLine).text}
          </div>
        ),
      )}
    </pre>
  );
}

// ---- 展开详情（无边框容器） ----
function ToolDetail({ msg, cwd }: { msg: ChatMessage; cwd?: string }) {
  const { t } = useTranslation();
  const { setPreviewPath } = useHubStore();
  const args = parseArgs(msg.toolArgs);
  const name = msg.toolName ?? '';
  const path = argPath(args);
  const result = cleanDisplayText(msg.text ?? '');

  const pathEl = path && (
    <button className="path-link" onClick={(e) => { e.stopPropagation(); setPreviewPath(path, cwd); }}>
      {path}
    </button>
  );

  if (/^(read|readmediafile)$/i.test(name) && isImagePath(path)) {
    return (
      <div className="tool-detail">
        <div className="tool-detail-head">{pathEl}</div>
        <SmartImage src={path} cwd={cwd} className="tool-image" />
      </div>
    );
  }
  if (/^read$/i.test(name)) {
    return (
      <div className="tool-detail">
        <div className="tool-detail-head">{pathEl}</div>
        {result && <HighlightedCode code={result} ext={extOf(path)} />}
      </div>
    );
  }
  if (/^(write|edit|multiedit|notebookedit)$/i.test(name)) {
    const oldText = String(args.old_string ?? '');
    const newText = String(args.new_string ?? args.content ?? '');
    return (
      <div className="tool-detail">
        <div className="tool-detail-head">{pathEl}</div>
        {newText ? (
          <DiffView oldText={oldText} newText={newText} />
        ) : (
          result && <pre className="tool-plain">{result.slice(0, 1500)}</pre>
        )}
      </div>
    );
  }
  if (/^(bash|shell|run|command_execution)$/i.test(name)) {
    const cmd = String(args.command ?? path ?? '');
    return (
      <div className="tool-detail">
        <div className="term-block">
          <div className="term-cmd">$ {cmd}</div>
          {result && <pre className="term-out">{result.slice(0, 3000)}</pre>}
        </div>
      </div>
    );
  }
  if (/^(glob|grep|search|find|ls)$/i.test(name)) {
    const files = result.split('\n').filter((l) => l.trim()).slice(0, 100);
    return (
      <div className="tool-detail">
        <div className="result-list">
          {files.map((f, i) => (
            <button key={i} className="path-link" onClick={(e) => { e.stopPropagation(); setPreviewPath(f.trim(), cwd); }}>
              {f.trim()}
            </button>
          ))}
        </div>
      </div>
    );
  }
  // 系统工具（TaskOutput/TaskList/CronCreate 等）：结构化渲染
  if (/^(taskoutput|tasklist|taskget|croncreate|cronlist|crondelete|taskcreate|taskstop)$/i.test(name)) {
    // 结果可能是 JSON
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(result) as Record<string, unknown>; } catch { /* 纯文本 */ }
    const statusVal = String(parsed?.status ?? parsed?.state ?? '');
    const statusKind = /completed|success|done/i.test(statusVal) ? 'done' : /fail|error/i.test(statusVal) ? 'error' : /run|progress/i.test(statusVal) ? 'running' : '';
    const fields: Array<[string, string]> = [];
    if (parsed) {
      for (const k of ['exit_code', 'exitCode', 'duration', 'duration_ms', 'description', 'task_id', 'taskId', 'stop_reason']) {
        if (parsed[k] !== undefined) fields.push([k, String(parsed[k])]);
      }
    }
    // 输出区（长文本）
    const outputText = String(parsed?.output ?? parsed?.output_preview ?? result);
    return (
      <div className="tool-detail">
        <div className="sys-tool">
          {statusVal && (
            <span className={`badge sys-status-${statusKind}`}>{statusVal}</span>
          )}
          {fields.map(([k, val]) => (
            <span key={k} className="sys-field"><span className="hint">{k}</span> <span className="mono">{val.slice(0, 60)}</span></span>
          ))}
        </div>
        {outputText && outputText !== '{}' && (
          <pre className="tool-plain">{outputText.slice(0, 2000)}</pre>
        )}
      </div>
    );
  }

  // 通用：参数 key-value 列表 + 结果
  const argEntries = Object.entries(args).filter(([, v]) => v !== undefined && v !== '');
  return (
    <div className="tool-detail">
      {argEntries.length > 0 && (
        <div className="sys-tool">
          {argEntries.map(([k, val]) => (
            <span key={k} className="sys-field">
              <span className="hint">{k}</span>{' '}
              <span className="mono">{String(val).slice(0, 80)}</span>
            </span>
          ))}
        </div>
      )}
      {result && (
        <pre className="tool-plain">{result.slice(0, 2000)}</pre>
      )}
    </div>
  );
}

// ---- TodoList / TodoWrite 专用清单 ----
interface TodoItem { title: string; status: string; }

function parseTodos(raw?: string): TodoItem[] | null {
  try {
    const args = JSON.parse(raw ?? '{}') as { todos?: Array<Record<string, unknown>> };
    if (!Array.isArray(args.todos)) return null;
    return args.todos.map((item) => ({
      title: String(item.title ?? item.content ?? item.task ?? ''),
      status: String(item.status ?? 'pending'),
    }));
  } catch {
    return null;
  }
}

function TodoListView({ todos, running }: { todos: TodoItem[]; running: boolean }) {
  return (
    <div className="todo-list">
      {todos.map((todo, i) => (
        <div key={i} className={`todo-item todo-${todo.status}`}>
          {todo.status === 'done' ? (
            <Check size={13} className="status-icon-done" />
          ) : todo.status === 'in_progress' ? (
            <CircleDot size={13} className={running ? 'spin-slow status-running' : 'status-running'} />
          ) : (
            <Circle size={13} className="todo-pending-icon" />
          )}
          <span className="todo-title">{todo.title}</span>
        </div>
      ))}
    </div>
  );
}

// ---- 状态圆点图标 ----
// 弱化态：无底色细线图标，低饱和
function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 size={13} className="spin status-running" />;
  if (status === 'error') return <X size={13} className="status-icon-error" />;
  return <Check size={13} className="status-icon-done" />;
}

// ---- 扁平摘要行 ----
export default function ToolCard({ msg, cwd }: { msg: ChatMessage; cwd?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const status = msg.toolStatus ?? 'done';
  const name = msg.toolName ?? 'tool';
  const args = parseArgs(msg.toolArgs);
  const { target, rest } = summaryOf(name, args);
  const todos = /^(todolist|todowrite|todo)$/i.test(name) ? parseTodos(msg.toolArgs) : null;

  // TodoList 类工具：清单样式，可折叠
  if (todos) {
    const doneCount = todos.filter((x) => x.status === 'done').length;
    return (
      <div className={`tool-row status-${status}`}>
        <div className="tool-row-head" onClick={() => setExpanded(!expanded)}>
          <StatusIcon status={status} />
          <span className="tool-row-name">{toolDisplayName(t, name)}</span>
          <span className="tool-row-rest">{`${doneCount}/${todos.length}`}</span>
          <span className="tool-row-chevron">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
        {expanded && <TodoListView todos={todos} running={status === 'running'} />}
      </div>
    );
  }

  return (
    <div className={`tool-row status-${status}`}>
      <div className="tool-row-head" onClick={() => setExpanded(!expanded)}>
        <StatusIcon status={status} />
        <span className="tool-row-name">{toolDisplayName(t, name)}</span>
        {target && <code className="tool-row-target">{target}</code>}
        {rest && <span className="tool-row-rest">{rest}</span>}
        <span className="tool-row-chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>
      {expanded && <ToolDetail msg={msg} cwd={cwd} />}
    </div>
  );
}
