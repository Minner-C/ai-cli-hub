// 设置页 - 供应商 tab：claude/codex 的 Anthropic·OpenAI 兼容端点预设管理
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import type { CliId, ProviderState } from '../../../electron/shared';

const SUPPORTED_CLIS: CliId[] = ['claude', 'codex'];

function CliProviderCard({ cliId, displayName }: { cliId: CliId; displayName: string }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [state, setState] = useState<ProviderState | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const refresh = useCallback(async () => {
    setState(await window.hub.getProviderState(cliId));
  }, [cliId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (p: Promise<unknown>) =>
    p.then(refresh).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  if (!state) return null;

  return (
    <div className="auth-card">
      <div className="auth-card-header">
        <strong>{displayName}</strong>
      </div>
      {state.presets.map((preset) => (
        <div key={preset.id} className="provider-row">
          <label className="provider-label">
            <input
              type="radio"
              name={`provider-${cliId}`}
              checked={state.activeId === preset.id}
              onChange={() => void run(window.hub.setActiveProvider(cliId, preset.id))}
            />
            <span>{preset.name}</span>
            {preset.external && <span className="badge">{t('provider.external')}</span>}
            {preset.baseUrl && <span className="hint mono provider-url">{preset.baseUrl}</span>}
          </label>
          {!preset.external && preset.id !== 'official' && (
            <div className="auth-key-row">
              <input
                type="password"
                placeholder={state.hasKey[preset.id] ? t('provider.keySaved') : t('auth.keyPlaceholder')}
                value={keyInputs[preset.id] ?? ''}
                onChange={(e) => setKeyInputs({ ...keyInputs, [preset.id]: e.target.value })}
              />
              <button
                className="secondary"
                disabled={!(keyInputs[preset.id] ?? '').trim()}
                onClick={() =>
                  void run(
                    window.hub.saveProviderKey(cliId, preset.id, (keyInputs[preset.id] ?? '').trim()),
                  ).then(() => setKeyInputs({ ...keyInputs, [preset.id]: '' }))
                }
              >
                {t('auth.save')}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* 自定义预设 */}
      <div className="provider-custom">
        <input
          placeholder={t('provider.customName')}
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
        />
        <input
          placeholder={t('provider.customUrl')}
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
        />
        <button
          className="secondary"
          disabled={!customName.trim() || !customUrl.trim()}
          onClick={() => {
            const first = state.presets.find((p) => !p.external) ?? state.presets[0];
            void run(
              window.hub.saveCustomProvider(cliId, {
                id: customName.trim().replace(/\s+/g, '-').toLowerCase(),
                name: customName.trim(),
                baseUrl: customUrl.trim(),
                envBaseUrl: first.envBaseUrl,
                envKey: first.envKey,
              }),
            ).then(() => {
              setCustomName('');
              setCustomUrl('');
            });
          }}
        >
          {t('provider.addCustom')}
        </button>
      </div>
    </div>
  );
}

export default function ProvidersTab() {
  const { t } = useTranslation();
  const { clis } = useHubStore();
  return (
    <div>
      <div className="hint">{t('provider.hint')}</div>
      {SUPPORTED_CLIS.map((id) => (
        <CliProviderCard
          key={id}
          cliId={id}
          displayName={clis.find((c) => c.id === id)?.displayName ?? id}
        />
      ))}
      <div className="hint">{t('provider.priorityNote')}</div>
    </div>
  );
}
