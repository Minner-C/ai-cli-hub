// 新增任务对话框：选择 CLI + 工作目录 → 创建任务线程
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId } from '../../electron/shared';

export default function NewChatDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { clis, createTask } = useHubStore();
  const installed = clis.filter((c) => c.installed);

  const [cliId, setCliId] = useState<CliId | ''>(installed[0]?.id ?? '');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);

  const pickDir = async () => {
    const dir = await window.hub.pickDirectory();
    if (dir) setCwd(dir);
  };

  const create = async () => {
    if (!cliId || !cwd) return;
    setBusy(true);
    await createTask(cliId, cwd);
    setBusy(false);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>{t('app.newChat')}</h2>

        <label>{t('app.chooseCli')}</label>
        {installed.length === 0 && <div className="hint">{t('sidebar.notInstalled')}</div>}
        <select value={cliId} onChange={(e) => setCliId(e.target.value as CliId)}>
          {installed.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>

        <label>{t('app.selectProject')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cwd} readOnly placeholder={t('app.dirPlaceholder')} style={{ flex: 1 }} />
          <button className="secondary" onClick={() => void pickDir()}>
            {t('app.browse')}
          </button>
        </div>

        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            {t('switch.cancel')}
          </button>
          <button disabled={!cliId || !cwd || busy} onClick={() => void create()}>
            {t('app.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
