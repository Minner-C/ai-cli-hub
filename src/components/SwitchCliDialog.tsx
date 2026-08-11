// 切换 CLI 对话框：选目标 CLI → 生成摘要（当前 CLI 无头总结）→ 预览 → 确认
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, Task } from '../../electron/shared';

export default function SwitchCliDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useTranslation();
  const { clis, refreshTasks, setError } = useHubStore();
  const candidates = clis.filter((c) => c.installed && c.id !== task.cli);

  const [target, setTarget] = useState<CliId | ''>('');
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 选定目标后请求主进程生成摘要
  const pickTarget = async (cliId: CliId) => {
    setTarget(cliId);
    setSummary(null);
    setBusy(true);
    try {
      const result = await window.hub.prepareSwitch(task.id, cliId);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!target || summary === null) return;
    setBusy(true);
    try {
      await window.hub.confirmSwitch(task.id, target, summary);
      await refreshTasks();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>{t('switch.title')}</h2>

        <label>{t('switch.target')}</label>
        <select
          value={target}
          onChange={(e) => e.target.value && void pickTarget(e.target.value as CliId)}
          disabled={busy}
        >
          <option value="">--</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>

        <label>{t('switch.summaryPreview')}</label>
        {busy && !summary ? (
          <div className="hint">{t('switch.generating')}</div>
        ) : (
          <div className="summary-preview">{summary ?? ''}</div>
        )}

        <div className="hint">{t('switch.hint')}</div>

        <div className="dialog-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            {t('switch.cancel')}
          </button>
          <button disabled={!target || summary === null || busy} onClick={confirm}>
            {t('switch.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
