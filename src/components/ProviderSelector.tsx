// 供应商选择器：聊天页顶栏 CLI 徽章旁，显示/切换当前生效预设
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../store';
import type { CliId, ProviderState } from '../../electron/shared';

export default function ProviderSelector({ cliId }: { cliId: CliId }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [state, setState] = useState<ProviderState | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.hub
      .getProviderState(cliId)
      .then((s) => {
        if (!cancelled) setState(s.presets.length > 0 ? s : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cliId]);

  if (!state) return null;

  const onChange = async (presetId: string) => {
    try {
      await window.hub.setActiveProvider(cliId, presetId);
      setState(await window.hub.getProviderState(cliId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <select
      className="model-selector provider-selector"
      value={state.activeId}
      title={t('provider.title')}
      onChange={(e) => void onChange(e.target.value)}
    >
      {state.presets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
