// 任务侧栏：搜索/仅进行中/日期分组/置顶/重命名/删除撤销
// 文件树内联在任务项下方，点击任务右侧的文件按钮展开/折叠
// 置顶/重命名/在文件管理器打开/删除 收纳到「更多」下拉
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderTree, MoreHorizontal, Pencil, Pin, PinOff, Search, Settings as SettingsIcon, Undo2, X, FolderOpen,
} from 'lucide-react';
import { useHubStore } from '../store';
import { groupOf, sortTasks, type TaskGroup, type Task } from '../../electron/shared';
import FilePanel from './FilePanel';

function fmtTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function TaskUsageBadge({ taskId }: { taskId: string }) {
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.hub.getTaskUsage(taskId).then((u) => {
      if (!cancelled) setUsage(u);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  if (!usage || (usage.input === 0 && usage.output === 0)) return null;
  return <span className="task-usage">{fmtTokens(usage.input + usage.output)}</span>;
}

const GROUP_ORDER: TaskGroup[] = ['today', 'yesterday', 'week', 'earlier'];

// 任务项「更多」下拉菜单
function MoreMenu({
  task, onRename, onPin, onReveal, onDelete,
}: {
  task: Task;
  onRename: () => void;
  onPin: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <div
      className="more-menu-item"
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        onClick();
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );

  return (
    <div className="more-menu-root" ref={ref}>
      <button
        className="icon-btn more-trigger"
        title={t('sidebar.more')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="more-menu-pop">
          {item(<Pencil size={12} />, t('sidebar.rename'), onRename)}
          {item(task.pinned ? <PinOff size={12} /> : <Pin size={12} />, task.pinned ? t('sidebar.unpin') : t('sidebar.pin'), onPin)}
          {item(<FolderOpen size={12} />, t('sidebar.reveal'), onReveal)}
          <div className="more-menu-sep" />
          {item(<X size={12} />, t('sidebar.delete'), onDelete)}
        </div>
      )}
    </div>
  );
}

export default function TaskSidebar({ onNewChat }: { onNewChat: () => void }) {
  const { t } = useTranslation();
  const {
    clis, tasks, activeTaskId, setActive, refreshTasks, runningTaskIds,
    expandedFileTaskId, toggleTaskFiles, setSettingsOpen,
  } = useHubStore();
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ task: Task; timer: ReturnType<typeof setTimeout> } | null>(null);

  const cliName = (id: string) => clis.find((c) => c.id === id)?.displayName ?? id;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tasks.filter((task) => task.id !== pendingDelete?.task.id);
    if (activeOnly) list = list.filter((task) => runningTaskIds.has(task.id));
    if (q) {
      list = list.filter(
        (task) =>
          (task.title ?? '').toLowerCase().includes(q) || task.cwd.toLowerCase().includes(q),
      );
    }
    return sortTasks(list);
  }, [tasks, query, activeOnly, pendingDelete]);

  const groups = useMemo(() => {
    const now = Date.now();
    const map = new Map<TaskGroup, Task[]>();
    for (const task of filtered) {
      const g = groupOf(task.updatedAt, now);
      map.set(g, [...(map.get(g) ?? []), task]);
    }
    return map;
  }, [filtered]);

  const doDelete = (task: Task) => {
    if (pendingDelete) clearTimeout(pendingDelete.timer);
    const timer = setTimeout(() => {
      void window.hub.deleteTask(task.id).then(refreshTasks);
      setPendingDelete(null);
    }, 5000);
    setPendingDelete({ task, timer });
    if (activeTaskId === task.id) setActive(null);
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    setPendingDelete(null);
  };

  const submitRename = async (taskId: string) => {
    const title = renameText.trim();
    if (title) {
      await window.hub.renameTask(taskId, title);
      await refreshTasks();
    }
    setRenamingId(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-top" style={{ padding: 12 }}>
        <button className="new-chat-btn" onClick={onNewChat}>
          ＋ {t('app.newChat')}
        </button>
        <div className="sidebar-search">
          <Search size={12} className="hint" />
          <input
            value={query}
            placeholder={t('sidebar.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="checkbox-label" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          <span className="hint">{t('sidebar.activeOnly')}</span>
        </label>
      </div>

      <div className="sidebar-tasks">
        {GROUP_ORDER.filter((g) => (groups.get(g) ?? []).length > 0).map((g) => (
          <div key={g}>
            <h3>{t(`sidebar.group.${g}`)}</h3>
            {(groups.get(g) ?? []).map((task) => {
              const isActive = task.id === activeTaskId;
              const filesOpen = expandedFileTaskId === task.id;
              return (
                <div key={task.id}>
                  {/* 任务行 */}
                  <div
                    className={`session-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActive(task.id)}
                    onDoubleClick={() => {
                      setRenamingId(task.id);
                      setRenameText(task.title ?? '');
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {renamingId === task.id ? (
                        <input
                          autoFocus
                          className="rename-input"
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => void submitRename(task.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void submitRename(task.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="task-title">
                          {task.pinned && <Pin size={10} className="pin-icon" />} {task.title || t('sidebar.untitled')}
                        </div>
                      )}
                      <div className="hint">
                        {cliName(task.cli)} <TaskUsageBadge taskId={task.id} />
                      </div>
                    </div>
                    <div className="session-actions">
                      {/* 文件树展开按钮 */}
                      <button
                        className={`task-files-btn ${filesOpen ? 'active' : ''}`}
                        title={t('panel.tab.files')}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTaskFiles(task.id);
                          if (!isActive) setActive(task.id);
                        }}
                      >
                        <FolderTree size={14} />
                      </button>
                      {/* 更多操作下拉 */}
                      <MoreMenu
                        task={task}
                        onRename={() => {
                          setRenamingId(task.id);
                          setRenameText(task.title ?? '');
                        }}
                        onPin={async () => {
                          await window.hub.pinTask(task.id, !task.pinned);
                          await refreshTasks();
                        }}
                        onReveal={() => void window.hub.revealInFolder(task.cwd)}
                        onDelete={() => doDelete(task)}
                      />
                    </div>
                  </div>
                  {/* 文件树展开面板 */}
                  {filesOpen && (
                    <div className="task-files-panel">
                      <FilePanel task={task} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {pendingDelete && (
          <div className="delete-toast">
            <span>{t('sidebar.deletedToast', { title: pendingDelete.task.title || t('sidebar.untitled') })}</span>
            <button onClick={undoDelete}>
              <Undo2 size={12} /> {t('sidebar.undo')}
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-settings-btn" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={15} />
          <span>{t('settings.title')}</span>
        </button>
      </div>
    </div>
  );
}
