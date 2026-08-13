// 输入框上方任务面板：待办清单 + 文件变更统计，双 tab，可展开收起
// 从消息流实时提取最新状态，随 task.messages 变化同步更新
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check, Circle, CircleDot, ChevronDown, ChevronRight, FileEdit, ListTodo, FolderOpen,
} from 'lucide-react';
import { useHubStore } from '../store';
import type { Task } from '../../electron/shared';
import { computeLineDiff, collapseContext, type DiffLine } from '../utils/diffUtil';

// ---- 待办解析 ----
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

// 从消息流提取最新一次 TodoWrite/TodoList 的清单（时间顺序后者覆盖前者）
function extractLatestTodos(task: Task): TodoItem[] | null {
  let latest: TodoItem[] | null = null;
  const clearedAt = task.todosClearedAt ?? 0;
  for (const msg of task.messages) {
    if (!msg.streaming && (msg.ts ?? 0) <= clearedAt) continue; // 清空标记之前的待办不再显示（流式消息始终算本轮）
    // 旧式 tool 消息
    if (msg.role === 'tool' && /^(todolist|todowrite|todo)$/i.test(msg.toolName ?? '')) {
      const t = parseTodos(msg.toolArgs);
      if (t) latest = t;
      continue;
    }
    // 新式 blocks 内嵌工具块
    if (msg.blocks) {
      for (const b of msg.blocks) {
        if (b.type === 'tool' && /^(todolist|todowrite|todo)$/i.test(b.name)) {
          const t = parseTodos(b.args);
          if (t) latest = t;
        }
      }
    }
  }
  return latest;
}

// ---- 文件变更聚合 ----
interface FileChange {
  path: string;
  ops: Array<{ tool: string; oldText: string; newText: string; status: string }>;
}

function extractFileChanges(task: Task): FileChange[] {
  const clearedAt = task.changesClearedAt ?? 0;
  const map = new Map<string, FileChange>();
  const collect = (name: string, argsRaw: string, status: string) => {
    if (!/^(write|edit|multiedit|notebookedit)$/i.test(name)) return;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsRaw ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }
    const p = String(args.file_path ?? args.path ?? args.filename ?? '');
    if (!p) return;
    const oldText = String(args.old_string ?? '');
    const newText = String(args.new_string ?? args.content ?? '');
    const entry = map.get(p) ?? { path: p, ops: [] };
    entry.ops.push({ tool: name, oldText, newText, status });
    map.set(p, entry);
  };
  for (const msg of task.messages) {
    if (!msg.streaming && (msg.ts ?? 0) <= clearedAt) continue; // 清空标记之前的变更不再显示（流式消息始终算本轮）
    if (msg.role === 'tool') collect(msg.toolName ?? '', msg.toolArgs ?? '', msg.toolStatus ?? 'done');
    if (msg.blocks) {
      for (const b of msg.blocks) {
        if (b.type === 'tool') collect(b.name, b.args, b.status);
      }
    }
  }
  return Array.from(map.values());
}

// ---- diff 渲染 ----
function MiniDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(
    () => collapseContext(computeLineDiff(oldText, newText)),
    [oldText, newText],
  );
  return (
    <pre className="ip-diff">
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

// ---- 待办清单视图 ----
function TodoTab({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { refreshTasks } = useHubStore();
  const todos = useMemo(() => extractLatestTodos(task), [task]);
  if (!todos || todos.length === 0) return null;
  const done = todos.filter((x) => x.status === 'done').length;
  const running = task.id === useHubStore.getState().runningTaskIds.values().next().value;
  return (
    <div className="ip-todo-list">
      <div className="ip-todo-actions">
        <button
          className="ip-text-btn"
          onClick={() => {
            void window.hub.clearTodos(task.id).then(() => refreshTasks());
          }}
        >
          {t('todo.clear')}
        </button>
      </div>
      <div className="ip-todo-progress">
        <div className="ip-progress-bar">
          <div className="ip-progress-fill" style={{ width: `${(done / todos.length) * 100}%` }} />
        </div>
        <span className="ip-progress-text">{done}/{todos.length}</span>
      </div>
      {todos.map((todo, i) => (
        <div key={i} className={`ip-todo-item todo-${todo.status}`}>
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

// ---- 文件变更视图 ----
function FileChangesTab({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { setPreviewPath, refreshTasks, setError } = useHubStore();
  const changes = useMemo(() => extractFileChanges(task), [task]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (changes.length === 0) return null;

  // 保留：确认改动，清空列表
  const onKeep = async () => {
    setBusy(true);
    try {
      await window.hub.clearChanges(task.id);
      await refreshTasks();
    } finally {
      setBusy(false);
    }
  };
  // 取消：git 还原文件内容，再清空列表
  const onDiscard = async () => {
    setBusy(true);
    try {
      const res = await window.hub.gitRestore(task.cwd, changes.map((c) => c.path));
      await window.hub.clearChanges(task.id);
      await refreshTasks();
      if (res.notRepo) setError(t('files.discardNotRepo'));
      else if (res.failed.length > 0) setError(t('files.discardPartial') + res.failed.join(', '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ip-files">
      <div className="ip-files-actions">
        <button className="keep-btn" disabled={busy} onClick={() => void onKeep()}>
          {t('files.keep')}
        </button>
        <button className="discard-btn" disabled={busy} onClick={() => void onDiscard()}>
          {t('files.discard')}
        </button>
      </div>
      {changes.map((fc) => {
        const base = fc.path.split(/[\\/]/).pop() ?? fc.path;
        const isOpen = openPath === fc.path;
        return (
          <div key={fc.path} className="ip-file-row">
            <div
              className="ip-file-head"
              onClick={() => setOpenPath(isOpen ? null : fc.path)}
            >
              <ChevronRight size={13} className={`ip-chevron ${isOpen ? 'open' : ''}`} />
              <FileEdit size={13} className="ip-file-icon" />
              <span className="ip-file-name">{base}</span>
              <span className="ip-file-count">{fc.ops.length}</span>
              <button
                className="ip-file-open"
                title={t('sidebar.reveal')}
                onClick={(e) => { e.stopPropagation(); setPreviewPath(fc.path, task.cwd); }}
              >
                <FolderOpen size={12} />
              </button>
            </div>
            {isOpen && (
              <div className="ip-file-detail">
                {fc.ops.map((op, i) => (
                  <div key={i} className="ip-op">
                    <div className="ip-op-tool">{op.tool}</div>
                    {op.newText ? <MiniDiff oldText={op.oldText} newText={op.newText} /> : (
                      <div className="hint">{t('chat.toolResult')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- 主面板 ----
export default function InputPanel({ task }: { task: Task }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'todo' | 'files'>('todo');
  const [collapsed, setCollapsed] = useState(false);

  const todos = useMemo(() => extractLatestTodos(task), [task]);
  const changes = useMemo(() => extractFileChanges(task), [task]);
  const todoCount = todos?.length ?? 0;
  const fileCount = changes.length;
  const hasContent = todoCount > 0 || fileCount > 0;
  if (!hasContent) return null;

  return (
    <div className="input-panel">
      <div className="ip-tabs">
        <button
          className={`ip-tab ${tab === 'todo' ? 'active' : ''} ${todoCount === 0 ? 'ip-tab-empty' : ''}`}
          onClick={() => { setTab('todo'); setCollapsed(false); }}
        >
          <ListTodo size={13} />
          <span>{t('chat.todoList')}</span>
          {todoCount > 0 && <span className="ip-tab-badge">{todoCount}</span>}
        </button>
        <button
          className={`ip-tab ${tab === 'files' ? 'active' : ''} ${fileCount === 0 ? 'ip-tab-empty' : ''}`}
          onClick={() => { setTab('files'); setCollapsed(false); }}
        >
          <FileEdit size={13} />
          <span>{t('chat.fileChanges')}</span>
          {fileCount > 0 && <span className="ip-tab-badge">{fileCount}</span>}
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="ip-collapse-btn"
          title={collapsed ? t('common.expand') : t('common.collapse')}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="ip-body">
          {tab === 'todo' && <TodoTab task={task} />}
          {tab === 'files' && <FileChangesTab task={task} />}
          {tab === 'todo' && todoCount === 0 && <div className="ip-empty">{t('chat.noTodo')}</div>}
          {tab === 'files' && fileCount === 0 && <div className="ip-empty">{t('chat.noFileChanges')}</div>}
        </div>
      )}
    </div>
  );
}
