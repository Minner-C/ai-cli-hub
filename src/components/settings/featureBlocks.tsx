// 各 CLI 设置页的差异化特性区块：按 CLI 真实能力提供独有内容
// dsh: 服务控制/凭证/插件管理/默认模型/profile；claude: env 变量表；codex: 自定义供应商；
// kimi: hooks/权限规则/技能目录；qwen: 扩展目录
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from '../../store';
import { Section, FormRow, SettingRow, InfoBanner } from './kit';
import type { CliId } from '../../../electron/shared';
import type { DshPluginEntry, DshProfile, DshCredentialStatus } from '../../../electron/dshManager';
import { Plug, Server, KeyRound, Boxes, ListTree, RefreshCw, FolderTree, Puzzle, ScrollText, Network } from 'lucide-react';

export function FeatureBlocks({ cliId }: { cliId: CliId }) {
  switch (cliId) {
    case 'dsh':
      return <DshBlocks />;
    case 'claude':
      return <ClaudeEnvBlock />;
    case 'codex':
      return <CodexProvidersBlock />;
    case 'kimi':
      return <KimiBlocks />;
    case 'qwen':
      return <QwenExtensionsBlock />;
    default:
      return null;
  }
}

// ============ dsh ============
function DshBlocks() {
  return (
    <>
      <DshServiceBlock />
      <DshCredentialBlock />
      <DshPluginBlock />
      <DshDefaultModelBlock />
      <DshProfileBlock />
    </>
  );
}

function DshServiceBlock() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [status, setStatus] = useState<{ running: boolean; url: string; port: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setStatus(await window.hub.dshServiceStatus().catch(() => null));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Section title={t('dsh.service')} desc={t('dsh.serviceDesc')}>
      <SettingRow
        icon={<Server size={16} />}
        title={
          <>
            {status?.running ? t('dsh.serviceRunning') : t('dsh.serviceStopped')}
            <span className="mono" style={{ marginLeft: 8, opacity: 0.7 }}>{status?.url ?? '…'}</span>
          </>
        }
        desc={t('dsh.servicePort', { port: status?.port ?? 3080 })}
        actions={
          <>
            <button className="secondary" disabled={busy} onClick={() => void reload()}>
              <RefreshCw size={13} />
            </button>
            {status?.running ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await window.hub.dshStopWeb();
                    if (!r.ok && r.message) setError(r.message);
                    await reload();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('dsh.stop')}
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await window.hub.dshStartWeb();
                    if (!r.ok) setError(r.message ?? 'failed');
                    await reload();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('dsh.start')}
              </button>
            )}
          </>
        }
      />
    </Section>
  );
}

function DshCredentialBlock() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [st, setSt] = useState<DshCredentialStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const reload = useCallback(async () => {
    setSt(await window.hub.dshCredentialStatus().catch(() => null));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const hasKey = st?.keys.includes('DEEPSEEK_API_KEY') ?? false;

  return (
    <Section title={t('dsh.credentials')} desc={st ? `${st.envPath} · ${t('dsh.credentialsDesc')}` : undefined}>
      <SettingRow
        icon={<KeyRound size={16} />}
        title="DEEPSEEK_API_KEY"
        desc={hasKey ? t('dsh.credentialSet') : t('dsh.credentialMissing')}
        actions={
          <>
            {st && st.keys.filter((k) => k !== 'DEEPSEEK_API_KEY').length > 0 && (
              <span className="hint mono">{st.keys.filter((k) => k !== 'DEEPSEEK_API_KEY').join(', ')}</span>
            )}
            <button className="secondary" onClick={() => setEditing((v) => !v)}>
              {hasKey ? t('dsh.replaceKey') : t('dsh.setKey')}
            </button>
            {hasKey && (
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await window.hub.dshWriteCredential('DEEPSEEK_API_KEY', null);
                    await reload();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                {t('dsh.clearKey')}
              </button>
            )}
          </>
        }
      />
      {editing && (
        <FormRow label="DEEPSEEK_API_KEY">
          <input
            type="password"
            value={value}
            placeholder="sk-..."
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              void (async () => {
                try {
                  await window.hub.dshWriteCredential('DEEPSEEK_API_KEY', value.trim());
                  setEditing(false);
                  setValue('');
                  await reload();
                } catch (err) {
                  setError(String(err));
                }
              })();
            }}
          />
        </FormRow>
      )}
      <div className="hint">{t('dsh.credentialHint')}</div>
    </Section>
  );
}

function DshPluginBlock() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [profiles, setProfiles] = useState<DshProfile[]>([]);
  const [profile, setProfile] = useState('web');
  const [plugins, setPlugins] = useState<DshPluginEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pkg, setPkg] = useState('');
  const [installing, setInstalling] = useState(false);
  const [opLog, setOpLog] = useState('');

  const reload = useCallback(async (p: string) => {
    setLoading(true);
    try {
      setPlugins(await window.hub.dshListPlugins(p));
    } catch (e) {
      setPlugins(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void window.hub.dshListProfiles().then((ps) => {
      setProfiles(ps);
      if (ps.length && !ps.some((p) => p.name === profile)) setProfile(ps[0].name);
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload(profile);
  }, [profile, reload]);

  const toggle = async (id: string, disabled: boolean) => {
    try {
      await window.hub.dshSetPluginDisabled(profile, id, disabled);
      await reload(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const install = async () => {
    const name = pkg.trim();
    if (!name) return;
    setInstalling(true);
    setOpLog('');
    try {
      const r = await window.hub.dshInstallPlugin(profile, name);
      setOpLog(r.output.slice(-2000));
      if (r.ok) {
        setPkg('');
        setProfiles(await window.hub.dshListProfiles().catch(() => profiles));
        await reload(profile);
      }
    } finally {
      setInstalling(false);
    }
  };

  const uninstall = async (name: string) => {
    setInstalling(true);
    setOpLog('');
    try {
      const r = await window.hub.dshUninstallPlugin(profile, name);
      setOpLog(r.output.slice(-2000));
      setProfiles(await window.hub.dshListProfiles().catch(() => profiles));
      await reload(profile);
    } finally {
      setInstalling(false);
    }
  };

  // 用户插件以 profile package.json 的 dependencies 为准（pnpm 安装）；
  // dump 树中用户层与 bundle 层已合成、无法区分来源
  const currentProfile = profiles.find((p) => p.name === profile);
  const userPlugins = currentProfile?.dependencies ?? [];
  const bundlePlugins = plugins ?? [];

  return (
    <Section title={t('dsh.plugins')} desc={t('dsh.pluginsDesc')}>
      <FormRow label="profile">
        <select value={profile} onChange={(e) => setProfile(e.target.value)}>
          {profiles.length === 0 && <option value="web">web</option>}
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </FormRow>
      {loading && <div className="hint">…</div>}
      {!loading && plugins === null && <InfoBanner>{t('dsh.pluginsLoadFailed')}</InfoBanner>}
      {userPlugins.length > 0 && (
        <>
          <div className="settings-subhead">{t('dsh.pluginsUser')}</div>
          {userPlugins.map((name) => (
            <SettingRow
              key={name}
              icon={<Plug size={16} />}
              title={<span className="mono">{name}</span>}
              actions={
                <button className="secondary" disabled={installing} onClick={() => void uninstall(name)}>
                  {t('dsh.uninstall')}
                </button>
              }
            />
          ))}
        </>
      )}
      {bundlePlugins.length > 0 && (
        <>
          <div className="settings-subhead">{t('dsh.pluginsBuiltin', { count: bundlePlugins.length })}</div>
          {bundlePlugins.map((p) => (
            <SettingRow
              key={p.id || p.name}
              icon={<Boxes size={16} />}
              title={<span className="mono">{p.id || p.name}</span>}
              desc={`${p.name ?? ''}${p.source ? ` · ${p.source.split(',')[0]}` : ''}`}
              actions={
                p.id ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!p.disabled}
                    className={`toggle ${p.disabled ? '' : 'on'}`}
                    disabled={installing}
                    onClick={() => void toggle(p.id, !p.disabled)}
                  />
                ) : undefined
              }
            />
          ))}
        </>
      )}
      <FormRow label={t('dsh.installPlugin')} desc={t('dsh.installPluginHint')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={pkg}
            placeholder="@scope/dsh-plugin-name"
            disabled={installing}
            onChange={(e) => setPkg(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void install()}
          />
          <button disabled={installing || !pkg.trim()} onClick={() => void install()}>
            {installing ? t('cliSettings.installing') : t('cliSettings.install')}
          </button>
        </div>
      </FormRow>
      {opLog && <pre className="install-output">{opLog}</pre>}
    </Section>
  );
}

function DshDefaultModelBlock() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void window.hub.dshGetDefaultModel('web').then((r) => {
      setProvider(r.provider ?? '');
      setModel(r.model ?? '');
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  return (
    <Section title={t('dsh.defaultModel')} desc={t('dsh.defaultModelDesc')}>
      <FormRow label="provider">
        <input
          defaultValue={provider}
          placeholder="deepseek-official"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === provider) return;
            setProvider(v);
            void window.hub.dshSetDefaultModel('web', v, model).catch((err) => setError(String(err)));
          }}
        />
      </FormRow>
      <FormRow label="model">
        <input
          defaultValue={model}
          placeholder="deepseek-v4-flash"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === model) return;
            setModel(v);
            void window.hub.dshSetDefaultModel('web', provider, v).catch((err) => setError(String(err)));
          }}
        />
      </FormRow>
      <div className="hint">{t('dsh.defaultModelHint')}</div>
    </Section>
  );
}

function DshProfileBlock() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<DshProfile[]>([]);
  useEffect(() => {
    void window.hub.dshListProfiles().then(setProfiles).catch(() => undefined);
  }, []);
  if (profiles.length === 0) return null;
  return (
    <Section title={t('dsh.profiles')} desc={t('dsh.profilesDesc')}>
      {profiles.map((p) => (
        <SettingRow
          key={p.name}
          icon={<ListTree size={16} />}
          title={<span className="mono">{p.name}</span>}
          desc={p.bundles.length ? p.bundles.join(' + ') : t('dsh.profileNoBundles')}
        />
      ))}
    </Section>
  );
}

// ============ claude：env 变量表（CC Switch 写入的 ANTHROPIC_* 端点/密钥）============
function ClaudeEnvBlock() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [env, setEnv] = useState<Record<string, string> | null>(null);
  const [reveal, setReveal] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const reload = useCallback(async () => {
    const doc = await window.hub.cliConfigReadDoc('claude');
    setEnv((doc.env as Record<string, string>) ?? {});
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!env) return null;

  const save = async (next: Record<string, string>) => {
    try {
      await window.hub.cliConfigWriteFields('claude', { env: next });
      setEnv(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const keys = Object.keys(env);
  return (
    <Section title={t('claude.env')} desc={t('claude.envDesc')}>
      {keys.length === 0 && <div className="hint">{t('claude.envEmpty')}</div>}
      {keys.map((k) => (
        <FormRow key={k} label={<span className="mono">{k}</span>}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={reveal ? 'text' : 'password'}
              defaultValue={env[k]}
              spellCheck={false}
              onBlur={(e) => {
                const v = e.target.value;
                if (v === env[k]) return;
                void save({ ...env, [k]: v });
              }}
            />
            <button
              className="secondary"
              title={t('claude.envDelete')}
              onClick={() => {
                const next = { ...env };
                delete next[k];
                void save(next);
              }}
            >
              ×
            </button>
          </div>
        </FormRow>
      ))}
      <FormRow label={t('claude.envAdd')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="ANTHROPIC_BASE_URL" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ flex: 1 }} />
          <input placeholder={t('claude.envValue')} value={newVal} onChange={(e) => setNewVal(e.target.value)} style={{ flex: 1 }} />
          <button
            disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newKey)}
            onClick={() => {
              void save({ ...env, [newKey]: newVal });
              setNewKey('');
              setNewVal('');
            }}
          >
            +
          </button>
        </div>
      </FormRow>
      {keys.length > 0 && (
        <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="secondary" onClick={() => setReveal((v) => !v)}>
            {reveal ? t('claude.envHide') : t('claude.envReveal')}
          </button>
        </div>
      )}
    </Section>
  );
}

// ============ codex：自定义供应商（[model_providers.*] 只读视图）============
function CodexProvidersBlock() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Array<{ id: string; name?: string; base_url?: string; wire_api?: string }> | null>(null);

  useEffect(() => {
    void window.hub.cliConfigReadDoc('codex').then((doc) => {
      const mp = (doc.model_providers ?? {}) as Record<string, Record<string, unknown>>;
      setProviders(
        Object.entries(mp).map(([id, v]) => ({
          id,
          name: v.name as string | undefined,
          base_url: v.base_url as string | undefined,
          wire_api: v.wire_api as string | undefined,
        })),
      );
    }).catch(() => setProviders([]));
  }, []);

  if (!providers) return null;
  return (
    <Section title={t('codex.providers')} desc={t('codex.providersDesc')}>
      {providers.length === 0 && <div className="hint">{t('codex.providersEmpty')}</div>}
      {providers.map((p) => (
        <SettingRow
          key={p.id}
          icon={<Network size={16} />}
          title={<span className="mono">{p.name ?? p.id}</span>}
          desc={<span className="mono">{p.base_url}{p.wire_api ? ` · ${p.wire_api}` : ''}</span>}
        />
      ))}
    </Section>
  );
}

// ============ kimi：hooks / 权限规则 / 额外技能目录 ============
function KimiBlocks() {
  const { t } = useTranslation();
  const { setError } = useHubStore();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);

  const reload = useCallback(async () => {
    setDoc(await window.hub.cliConfigReadDoc('kimi'));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!doc) return null;
  const hooks = Array.isArray(doc.hooks) ? doc.hooks : [];
  const rules = (doc.permission as Record<string, unknown> | undefined)?.rules;
  const ruleList = Array.isArray(rules) ? rules : [];
  const extraDirs = Array.isArray(doc.extra_skill_dirs) ? (doc.extra_skill_dirs as string[]) : [];

  return (
    <>
      <Section title={t('kimi.automation')} desc={t('kimi.automationDesc')}>
        <SettingRow
          icon={<ScrollText size={16} />}
          title={t('kimi.hooksCount', { count: hooks.length })}
          desc={t('kimi.hooksHint')}
        />
        <SettingRow
          icon={<Puzzle size={16} />}
          title={t('kimi.rulesCount', { count: ruleList.length })}
          desc={t('kimi.rulesHint')}
        />
        <SettingRow
          icon={<FolderTree size={16} />}
          title={t('kimi.mcpEntry')}
          desc="~/.kimi-code/mcp.json"
        />
      </Section>
      <Section title={t('kimi.skillDirs')} desc={t('kimi.skillDirsDesc')}>
        <FormRow label="extra_skill_dirs">
          <input
            defaultValue={extraDirs.join(', ')}
            placeholder="D:/skills/shared, D:/skills/team"
            onBlur={(e) => {
              const arr = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              void window.hub
                .cliConfigWriteFields('kimi', { extra_skill_dirs: arr.length ? arr : undefined })
                .then(reload)
                .catch((err) => setError(String(err)));
            }}
          />
        </FormRow>
      </Section>
    </>
  );
}

// ============ qwen：扩展目录 ============
function QwenExtensionsBlock() {
  const { t } = useTranslation();
  const [exts, setExts] = useState<string[] | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { home } = await window.hub.getAppInfo();
        const entries = await window.hub.listDir(`${home}/.qwen/extensions`);
        setExts(entries.filter((e) => e.isDir).map((e) => e.name));
      } catch {
        setExts([]);
      }
    })();
  }, []);
  if (!exts || exts.length === 0) return null;
  return (
    <Section title={t('qwen.extensions')} desc="~/.qwen/extensions">
      {exts.map((name) => (
        <SettingRow key={name} icon={<Puzzle size={16} />} title={<span className="mono">{name}</span>} />
      ))}
    </Section>
  );
}
