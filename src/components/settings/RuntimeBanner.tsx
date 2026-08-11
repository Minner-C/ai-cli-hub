// 运行时环境状态条：显示 Node.js / Python / ACP adapter 安装状态，缺失时一键安装
// 面向小白：安装后提示重启应用以让 PATH 生效
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, RefreshCw, AlertCircle, Cpu, Plug } from 'lucide-react';
import type { RuntimeKind, RuntimeStatus } from '../../../electron/envInstaller';
import type { AdapterStatus } from '../../../electron/acpClient';
import type { CliId } from '../../../electron/shared';
import { Section, SettingRow } from './kit';

type InstallState = 'idle' | 'installing' | 'success' | 'error';

export default function RuntimeBanner() {
  const { t } = useTranslation();
  const [runtimes, setRuntimes] = useState<RuntimeStatus[] | null>(null);
  const [adapters, setAdapters] = useState<AdapterStatus[] | null>(null);
  const [rtStates, setRtStates] = useState<Partial<Record<RuntimeKind, { status: InstallState; output: string; message: string }>>>({});
  const [adStates, setAdStates] = useState<Partial<Record<string, { status: InstallState; output: string; message: string }>>>({});

  const refresh = () => {
    void window.hub.checkRuntimes().then(setRuntimes).catch(() => undefined);
    void window.hub.checkAdapters().then(setAdapters).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    const offRtProgress = window.hub.onRuntimeProgress((kind, chunk) => {
      setRtStates((s) => {
        const cur = s[kind] ?? { status: 'installing' as InstallState, output: '', message: '' };
        return { ...s, [kind]: { ...cur, status: 'installing', output: (cur.output + chunk).slice(-4000) } };
      });
    });
    const offRtDone = window.hub.onRuntimeDone((kind, ok, message) => {
      setRtStates((s) => ({
        ...s,
        [kind]: { ...(s[kind] ?? { output: '', message: '' }), status: ok ? 'success' : 'error', message },
      }));
      if (ok) refresh();
    });
    const offAdProgress = window.hub.onAdapterProgress((cliId, chunk) => {
      setAdStates((s) => {
        const cur = s[cliId] ?? { status: 'installing' as InstallState, output: '', message: '' };
        return { ...s, [cliId]: { ...cur, status: 'installing', output: (cur.output + chunk).slice(-4000) } };
      });
    });
    const offAdDone = window.hub.onAdapterDone((cliId, ok, message) => {
      setAdStates((s) => ({
        ...s,
        [cliId]: { ...(s[cliId] ?? { output: '', message: '' }), status: ok ? 'success' : 'error', message },
      }));
      if (ok) refresh();
    });
    return () => {
      offRtProgress();
      offRtDone();
      offAdProgress();
      offAdDone();
    };
  }, []);

  const startRuntimeInstall = async (kind: RuntimeKind) => {
    setRtStates((s) => ({ ...s, [kind]: { status: 'installing', output: '', message: '' } }));
    const res = await window.hub.installRuntime(kind);
    if (!res.ok) {
      setRtStates((s) => ({ ...s, [kind]: { status: 'error', output: '', message: res.message } }));
    }
  };

  const startAdapterInstall = async (cliId: CliId) => {
    setAdStates((s) => ({ ...s, [cliId]: { status: 'installing', output: '', message: '' } }));
    const res = await window.hub.installAdapter(cliId);
    if (!res.ok) {
      setAdStates((s) => ({ ...s, [cliId]: { status: 'error', output: '', message: res.message } }));
    }
  };

  if (!runtimes) return null;

  const allRtInstalled = runtimes.every((r) => r.installed);
  const hasRtError = Object.values(rtStates).some((s) => s?.status === 'error' || s?.status === 'installing');
  const allAdInstalled = !adapters || adapters.every((a) => a.installed);
  const hasAdError = Object.values(adStates).some((s) => s?.status === 'error' || s?.status === 'installing');
  if (allRtInstalled && !hasRtError && allAdInstalled && !hasAdError) return null;

  // 渲染单个状态行（运行时或 adapter 共用），复用 SettingRow 三段式布局
  const renderRow = (opts: {
    key: string;
    icon: React.ReactNode;
    label: string;
    sublabel?: string;
    installed: boolean;
    status?: InstallState;
    output?: string;
    message?: string;
    onInstall: () => void;
  }) => {
    const installing = opts.status === 'installing';
    const error = opts.status === 'error';
    const success = opts.status === 'success';
    const title = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {opts.label}
        {opts.sublabel && <span className="mono hint">{opts.sublabel}</span>}
        {opts.installed ? (
          <span className="badge auth-logged-in">
            <Check size={10} /> {t('runtime.installed')}
          </span>
        ) : error ? (
          <span className="badge auth-none">
            <AlertCircle size={10} /> {t('runtime.installFailed')}
          </span>
        ) : success ? (
          <span className="badge auth-logged-in">
            <Check size={10} /> {t('runtime.installDone')}
          </span>
        ) : (
          <span className="badge auth-none">{t('runtime.notInstalled')}</span>
        )}
      </span>
    );
    const desc = success && !opts.installed ? t('runtime.restartHint') : undefined;
    const actions = !opts.installed && !success ? (
      <button className="error-retry" disabled={installing} onClick={opts.onInstall}>
        {installing ? (
          <><RefreshCw size={12} className="spin" /> {t('runtime.installing')}</>
        ) : error ? (
          <><AlertCircle size={12} /> {t('error.retry')}</>
        ) : (
          <><Download size={12} /> {t('runtime.install')}</>
        )}
      </button>
    ) : undefined;
    return (
      <div key={opts.key} className="runtime-row-wrap">
        <SettingRow icon={opts.icon} title={title} desc={desc} actions={actions} />
        {installing && opts.output && (
          <pre className="install-output" style={{ margin: '0 0 8px 36px', maxHeight: '120px' }}>{opts.output}</pre>
        )}
        {error && opts.message && (
          <div className="install-output error" style={{ margin: '0 0 8px 36px' }}>{opts.message}</div>
        )}
      </div>
    );
  };

  const needRuntime = !allRtInstalled || hasRtError;
  const needAdapter = !allAdInstalled || hasAdError;

  return (
    <>
      {needRuntime && (
        <Section title={t('runtime.runtimeEnv')} desc={t('runtime.runtimeHint')}>
          {runtimes.map((rt) =>
            renderRow({
              key: rt.kind,
              icon: <Cpu size={15} className="hint" />,
              label: rt.kind === 'node' ? 'Node.js' : 'Python',
              installed: rt.installed,
              status: rtStates[rt.kind]?.status,
              output: rtStates[rt.kind]?.output,
              message: rtStates[rt.kind]?.message,
              onInstall: () => void startRuntimeInstall(rt.kind),
            }),
          )}
        </Section>
      )}
      {needAdapter && adapters && (
        <Section title={t('runtime.adapters')} desc={t('runtime.adapterHint')}>
          {adapters.map((ad) =>
            renderRow({
              key: `adapter-${ad.cliId}`,
              icon: <Plug size={15} className="hint" />,
              label: ad.adapterCommand,
              sublabel: t('runtime.adapterFor', { cli: ad.cliId }),
              installed: ad.installed,
              status: adStates[ad.cliId]?.status,
              output: adStates[ad.cliId]?.output,
              message: adStates[ad.cliId]?.message,
              onInstall: () => void startAdapterInstall(ad.cliId),
            }),
          )}
        </Section>
      )}
    </>
  );
}
