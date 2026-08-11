// 设置页 - 账号与密钥 tab：每个 CLI 一张卡片
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { Eye, EyeOff } from 'lucide-react';
import type { CliAuthStatus, CliId } from '../../../electron/shared';

// 各 CLI 的鉴权能力：只有支持 API Key 或登录命令的 CLI 才显示鉴权卡片
const KEY_CLIS: CliId[] = ['claude', 'gemini', 'codex', 'qwen', 'pi', 'hermes']; // 有标准 key env
const LOGIN_CLIS: CliId[] = ['kimi', 'claude', 'gemini', 'codex'];               // 有官方登录命令

export function AuthCard({ cliId, displayName, installed = true }: { cliId: CliId; displayName: string; installed?: boolean }) {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [status, setStatus] = useState<CliAuthStatus | null>(null);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const supportsKey = KEY_CLIS.includes(cliId);
  const supportsLogin = LOGIN_CLIS.includes(cliId);

  const refresh = async () => {
    const all = await window.hub.getAuthStatus();
    setStatus(all[cliId]);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliId]);

  // 既无 API Key 又无登录命令的 CLI（如 aider / opencode）：不显示鉴权卡片
  if (!supportsKey && !supportsLogin) return null;

  const statusLabel = status ? t(`auth.source.${status.source}`) : '…';

  const save = async () => {
    try {
      await window.hub.saveApiKey(cliId, key.trim());
      setKey('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const clear = async () => {
    await window.hub.clearApiKey(cliId);
    await refresh();
  };

  return (
    <div className="auth-card">
      <div className="auth-card-header">
        <strong>{displayName}</strong>
        <span className={`badge auth-${status?.source ?? 'none'}`}>{statusLabel}</span>
      </div>
      {status?.detail && (
        <div className="hint">
          {t('auth.sourceDetail')}: {status.detail}
        </div>
      )}

      {supportsKey && (
        <div className="auth-key-row">
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            placeholder={t('auth.keyPlaceholder')}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="secondary" onClick={() => setShowKey(!showKey)} title={t('auth.toggleShow')}>
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button className="secondary" disabled={!key.trim()} onClick={() => void save()}>
            {t('auth.save')}
          </button>
          {status?.source === 'app-key' && (
            <button className="secondary" onClick={() => void clear()}>
              {t('auth.clear')}
            </button>
          )}
        </div>
      )}

      <div className="auth-actions">
        {supportsLogin && (
          <button
            className="secondary"
            disabled={!installed}
            title={!installed ? t('sidebar.notInstalled') : undefined}
            onClick={async () => {
              const res = await window.hub.loginCli(cliId);
              if (!res.ok) setError(res.message);
            }}
          >
            {t('auth.login')}
          </button>
        )}
        <button className="secondary" onClick={() => void refresh()}>
          {t('auth.refresh')}
        </button>
      </div>
      {/* 登录提示仅对支持登录的 CLI 显示；仅 API Key 的 CLI 显示密钥相关提示 */}
      {supportsLogin && (
        <div className="hint">{cliId === 'qwen' ? t('auth.qwenLoginHint') : t('auth.loginHint')}</div>
      )}
      {supportsKey && !supportsLogin && (
        <div className="hint">{t('auth.keyOnlyHint')}</div>
      )}
      <div className="hint">{t('auth.storageNotice')}</div>
    </div>
  );
}

export default function AuthTab() {
  const { t } = useTranslation();
  const { clis } = useHubStore();
  return (
    <div>
      {clis.map((cli) => (
        <AuthCard key={cli.id} cliId={cli.id} displayName={cli.displayName} />
      ))}
      <div className="hint">{t('auth.storageNotice')}</div>
    </div>
  );
}
