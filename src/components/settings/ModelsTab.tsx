// 设置页 - 模型 tab：每个 CLI 的默认模型设置
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import type { CliId, ModelInfo } from '../../../electron/shared';

function CliModelRow({ cliId, displayName }: { cliId: CliId; displayName: string }) {
  const { t } = useTranslation();
  const { settings, applySettings } = useHubStore();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.hub
      .listModels(cliId)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [cliId]);

  const value = settings?.defaultModels?.[cliId] ?? '';

  return (
    <div className="model-row">
      <span className="model-row-name">{displayName}</span>
      {loading ? (
        <span className="hint">…</span>
      ) : models.length === 0 ? (
        <span className="hint">{t('models.unavailable')}</span>
      ) : (
        <select
          value={value}
          onChange={(e) =>
            void applySettings({
              defaultModels: { ...settings?.defaultModels, [cliId]: e.target.value || undefined },
            })
          }
        >
          <option value="">{t('models.cliDefault')}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function ModelsTab() {
  const { t } = useTranslation();
  const { clis } = useHubStore();
  return (
    <div>
      <div className="hint">{t('models.hint')}</div>
      {clis.map((cli) => (
        <CliModelRow key={cli.id} cliId={cli.id} displayName={cli.displayName} />
      ))}
    </div>
  );
}
