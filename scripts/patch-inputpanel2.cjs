// 补丁：InputPanel 待办清空 + 保留/取消按钮配色
const fs = require('fs');
const path = 'src/components/InputPanel.tsx';
let s = fs.readFileSync(path, 'utf8');
const NL = s.includes('\r\n') ? '\r\n' : '\n';
const L = (text) => text.split('\n').join(NL);

// 1. extractLatestTodos 按 todosClearedAt 过滤
const oldExtract = L(`function extractLatestTodos(task: Task): TodoItem[] | null {
  let latest: TodoItem[] | null = null;
  for (const msg of task.messages) {`);
const newExtract = L(`function extractLatestTodos(task: Task): TodoItem[] | null {
  let latest: TodoItem[] | null = null;
  const clearedAt = task.todosClearedAt ?? 0;
  for (const msg of task.messages) {
    if ((msg.ts ?? 0) <= clearedAt) continue; // 清空标记之前的待办不再显示`);
if (!s.includes(oldExtract)) throw new Error('extract anchor not found');
s = s.replace(oldExtract, newExtract);

// 2. TodoTab 加清空按钮（有内容时显示在进度行右侧）
const oldTodoHead = L(`function TodoTab({ task }: { task: Task }) {
  const todos = useMemo(() => extractLatestTodos(task), [task]);
  if (!todos || todos.length === 0) return null;
  const done = todos.filter((x) => x.status === 'done').length;
  const running = task.id === useHubStore.getState().runningTaskIds.values().next().value;
  return (
    <div className="ip-todo-list">
      <div className="ip-todo-progress">`);
const newTodoHead = L(`function TodoTab({ task }: { task: Task }) {
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
      <div className="ip-todo-progress">`);
if (!s.includes(oldTodoHead)) throw new Error('todo anchor not found');
s = s.replace(oldTodoHead, newTodoHead);

fs.writeFileSync(path, s);
console.log('PATCH OK');
