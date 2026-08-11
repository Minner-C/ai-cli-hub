// CLI 设置列表页：安装状态机（idle/installing/success/error）+ 行内输出 + 一键安装/更新
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Download, RefreshCw, Check, AlertCircle, Sparkles } from 'lucide-react';
import { useHubStore } from '../../store';
import { PageHeader, SettingRow, InfoBanner } from './kit';
import RuntimeBanner from './RuntimeBanner';
import BrandLogo from '../BrandLogo';
import type { CliId } from '../../../electron/shared';

const CLI_IDS: CliId[] = ['kimi', 'claude', 'gemini', 'codex', 'qwen', 'opencode', 'aider', 'pi', 'hermes'];

type InstallStatus = 'idle' | 'installing' | 'success' | 'error';

interface RowState {
  status: InstallStatus;
  output: string;
  message: string;
  expanded: boolean;
}

const IDLE: RowState = { status: 'idle', output: '', message: '', expanded: false };

// 版本徽标（已安装的惰性获取）
function VersionText({ cliId, installed }: { cliId: CliId; installed: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!installed) return;
    void window.hub.cliVersion(cliId).then(setVersion).catch(() => undefined);
  }, [cliId, installed]);
  if (!installed) return null;
  return <span className="mono hint">{version ?? '…'}</span>;
}

export default function CliListPage({ onOpen }: { onOpen: (cliId: CliId) => void }) {
  const { t } = useTranslation();
  const { clis, refreshClis, setError } = useHubStore();
  const [refreshing, setRefreshing] = useState(false);
  const [states, setStates] = useState<Partial<Record<CliId, RowState>>>({});

  const patch = (cliId: CliId, p: Partial<RowState>) =>
    setStates((s) => ({ ...s, [cliId]: { ...(s[cliId] ?? IDLE), ...p } }));

  // 订阅安装进度/完成事件
  useEffect(() => {
    const offProgress = window.hub.onInstallProgress((cliId, chunk) => {
      setStates((s) => {
        const cur = s[cliId] ?? IDLE;
        return { ...s, [cliId]: { ...cur, status: 'installing', output: (cur.output + chunk).slice(-4000) } };
      });
    });
    const offDone = window.hub.onInstallDone((cliId, ok, message) => {
      patch(cliId, { status: ok ? 'success' : 'error', message });
      if (ok) void refreshClis();
    });
    return () => {
      offProgress();
      offDone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startInstall = async (cliId: CliId) => {
    patch(cliId, { status: 'installing', output: '', message: '', expanded: true });
    const res = await window.hub.cliInstall(cliId);
    if (!res.ok) {
      // 运行时缺失：翻译为友好提示
      const m = res.message || '';
      const match = m.match(/^runtime:missing:(node|python)$/);
      const friendly = match
        ? t(match[1] === 'python' ? 'runtime.missingPython' : 'runtime.missingNode')
        : m;
      patch(cliId, { status: 'error', message: friendly });
    }
  };

  return (
    <div>
      <PageHeader
        title={t('settings.tab.cliSettings')}
        desc={t('cliSettings.listDesc')}
        action={{ label: t('auth.refresh'), icon: <RefreshCw size={14} className={refreshing ? 'spin' : ''} />, onClick: async () => {
          setRefreshing(true);
          await refreshClis();
          setRefreshing(false);
        } }}
      />
      <InfoBanner>{t('cliSettings.listHint')}</InfoBanner>
      <RuntimeBanner />

      {CLI_IDS.map((id) => {
        const cli = clis.find((c) => c.id === id);
        const installed = cli?.installed ?? false;
        const st = states[id] ?? IDLE;
        return (
          <div key={id}>
            <div onClick={() => installed && onOpen(id)} style={{ cursor: installed ? 'pointer' : 'default' }}>
              <SettingRow
                icon={<BrandLogo brand={id} size={16} />}
                title={
                  <>
                    {cli?.displayName ?? id}
                    {st.status === 'success' && (
                      <span className="badge auth-logged-in">
                        <Check size={10} /> {t('cliSettings.installDone')}
                      </span>
                    )}
                  </>
                }
                desc={<VersionText cliId={id} installed={installed} />}
                actions={
                  installed ? (
                    <ChevronRight size={15} className="hint" />
                  ) : st.status === 'installing' ? (
                    <span className="install-progress">
                      <RefreshCw size={13} className="spin" />
                      <span className="hint">{t('cliSettings.installing')}</span>
                      <button
                        className="icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          patch(id, { expanded: !st.expanded });
                        }}
                      >
                        {st.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="error-retry"
                      onClick={(e) => {
                        e.stopPropagation();
                        void startInstall(id).catch((err) =>
                          setError(err instanceof Error ? err.message : String(err)),
                        );
                      }}
                    >
                      {st.status === 'error' ? (
                        <>
                          <AlertCircle size={12} /> {t('error.retry')}
                        </>
                      ) : (
                        <>
                          <Download size={12} /> {t('cliSettings.install')}
                        </>
                      )}
                    </button>
                  )
                }
              />
            </div>
            {st.status === 'installing' && st.expanded && st.output && (
              <pre className="install-output">{st.output}</pre>
            )}
            {st.status === 'error' && (
              <div className="install-output error">
                {st.message && <div>{st.message}</div>}
                {st.output && <pre>{st.output}</pre>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
