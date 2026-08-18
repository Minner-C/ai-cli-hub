// 补丁：任务列表按文件夹分组
const fs = require('fs');
const p = 'src/components/TaskSidebar.tsx';
let s = fs.readFileSync(p, 'utf8');
const NL = s.includes('\r\n') ? '\r\n' : '\n';
const L = (t) => t.split('\n').join(NL);

// 1. groups useMemo：日期分组 → 文件夹分组（含折叠状态）
const oldGroups = L(`  const groups = useMemo(() => {
    const now = Date.now();
    const map = new Map<TaskGroup, Task[]>();
    for (const task of filtered) {
      const g = groupOf(task.updatedAt, now);
      map.set(g, [...(map.get(g) ?? []), task]);
    }
    return map;
  }, [filtered]);`);
const newGroups = L(`  // 按项目文件夹分组：键 = cwd（空为未分组）；组内沿用 sortTasks 顺序
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const folderGroups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of filtered) {
      const dir = task.cwd || '';
      map.set(dir, [...(map.get(dir) ?? []), task]);
    }
    // 组排序：按组内最新任务时间倒序；未分组垫底
    return Array.from(map.entries()).sort(([da, ta], [db, tb]) => {
      if (!da) return 1;
      if (!db) return -1;
      const la = Math.max(...ta.map((x) => x.updatedAt));
      const lb = Math.max(...tb.map((x) => x.updatedAt));
      return lb - la;
    });
  }, [filtered]);

  const toggleDir = (dir: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };`);
if (!s.includes(oldGroups)) throw new Error('groups anchor not found');
s = s.replace(oldGroups, newGroups);

// 2. 渲染：日期组头 → 文件夹组头 + 折叠
const oldRender = L(`      <div className="sidebar-tasks">
        {GROUP_ORDER.filter((g) => (groups.get(g) ?? []).length > 0).map((g) => (
          <div key={g}>
            <h3>{t(\`sidebar.group.\${g}\`)}</h3>
            {(groups.get(g) ?? []).map((task) => {`);
const newRender = L(`      <div className="sidebar-tasks">
        {folderGroups.map(([dir, dirTasks]) => {
          const dirName = dir ? dir.split(/[\\\\/]/).filter(Boolean).pop() ?? dir : t('sidebar.ungrouped');
          const collapsed = collapsedDirs.has(dir);
          return (
          <div key={dir || '__ungrouped__'}>
            <div className="dir-head" title={dir || t('sidebar.ungrouped')} onClick={() => toggleDir(dir)}>
              <Folder size={13} className="dir-icon" />
              <ChevronRight size={12} className={\`ip-chevron \${collapsed ? '' : 'open'}\`} />
              <span className="dir-name">{dirName}</span>
              <span className="hint dir-count">{dirTasks.length}</span>
            </div>
            {!collapsed && dirTasks.map((task) => {`);
if (!s.includes(oldRender)) throw new Error('render anchor not found');
s = s.replace(oldRender, newRender);

// 3. 组尾闭合
const oldTail = L(`            })}
          </div>
        ))}

        {pendingDelete && (`);
const newTail = L(`            })}
          </div>
          );
        })}

        {pendingDelete && (`);
if (!s.includes(oldTail)) throw new Error('tail anchor not found');
s = s.replace(oldTail, newTail);

// 4. 任务行加相对时间（hint 行末尾）
const oldHint = L(`                      <div className="hint">
                        {cliName(task.cli)} <TaskUsageBadge taskId={task.id} />
                      </div>`);
const newHint = L(`                      <div className="hint">
                        {cliName(task.cli)} <TaskUsageBadge taskId={task.id} />
                        <span className="task-time">{relTime(task.updatedAt, t)}</span>
                      </div>`);
if (!s.includes(oldHint)) throw new Error('hint anchor not found');
s = s.replace(oldHint, newHint);

// 5. import 调整：去掉 groupOf/TaskGroup 未用引用，加 Folder/ChevronRight 图标与 relTime
const oldImport = L(`import { groupOf, sortTasks, type TaskGroup, type Task } from '../../electron/shared';`);
const newImport = L(`import { sortTasks, type Task } from '../../electron/shared';`);
if (!s.includes(oldImport)) throw new Error('import anchor not found');
s = s.replace(oldImport, newImport);

fs.writeFileSync(p, s);
console.log('PATCH OK');
