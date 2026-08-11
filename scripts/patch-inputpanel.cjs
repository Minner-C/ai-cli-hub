// 补丁：InputPanel 文件变更 —— clearedAt 过滤生效 + 保留/取消按钮
const fs = require('fs');
const path = 'src/components/InputPanel.tsx';
let s = fs.readFileSync(path, 'utf8');
const NL = s.includes('\r\n') ? '\r\n' : '\n';
const L = (text) => text.split('\n').join(NL);

// 1. clearedAt 过滤生效
const oldLoop = L(`  for (const msg of task.messages) {
    if (msg.role === 'tool') collect(msg.toolName ?? '', msg.toolArgs ?? '', msg.toolStatus ?? 'done');`);
const newLoop = L(`  for (const msg of task.messages) {
    if ((msg.ts ?? 0) <= clearedAt) continue; // 清空标记之前的变更不再显示
    if (msg.role === 'tool') collect(msg.toolName ?? '', msg.toolArgs ?? '', msg.toolStatus ?? 'done');`);
if (!s.includes(oldLoop)) throw new Error('loop anchor not found');
s = s.replace(oldLoop, newLoop);

// 2. FileChangesTab：加保留/取消按钮
const oldHead = L(`function FileChangesTab({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { setPreviewPath } = useHubStore();
  const changes = useMemo(() => extractFileChanges(task), [task]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  if (changes.length === 0) return null;
  return (
    <div className="ip-files">`);
const newHead = L(`function FileChangesTab({ task }: { task: Task }) {
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
        <button className="secondary" disabled={busy} onClick={() => void onKeep()}>
          {t('files.keep')}
        </button>
        <button className="secondary danger" disabled={busy} onClick={() => void onDiscard()}>
          {t('files.discard')}
        </button>
      </div>`);
if (!s.includes(oldHead)) throw new Error('FileChangesTab anchor not found');
s = s.replace(oldHead, newHead);

fs.writeFileSync(path, s);
console.log('PATCH OK');
