// 设置面板：TRAE Solo 左右布局——扁平导航（图标+分组细线+应用标识区）+ 内容页骨架
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings, Cpu, Sparkles, Plug, BarChart3, Terminal, Info, X, FolderOpen,
} from 'lucide-react';
import { useHubStore } from '../store';
import ModelProvidersTab from './settings/ModelProvidersTab';
import SkillsTab from './settings/SkillsTab';
import McpTab from './settings/McpTab';
import UsageTab from './settings/UsageTab';
import CliSettingsPage from './settings/CliSettingsPage';
import CliListPage from './settings/CliListPage';
import { PageHeader, Section, FormRow } from './settings/kit';
import type { CliId, Language, ThemeMode, CloseBehavior } from '../../electron/shared';

type PageId = 'general' | 'modelProviders' | 'skills' | 'mcp' | 'usage' | 'about' | 'cliSettings' | `cli:${CliId}`;
const CLI_IDS: CliId[] = ['kimi', 'claude', 'gemini', 'codex', 'qwen', 'opencode', 'aider', 'pi', 'hermes'];

function AboutPage() {
  const { t } = useTranslation();
  const { clis } = useHubStore();
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.hub.getAppInfo().then((i) => setVersion(i.version));
  }, []);
  return (
    <div>
      <PageHeader title="AI CLI Hub" desc={t('about.desc')} />
      <Section title={t('about.version')}>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-title">{t('about.version')}</div>
          </div>
          <span className="mono">{version}</span>
        </div>
      </Section>
      <Section title={t('about.cliStatus')}>
        {clis.map((cli) => (
          <div key={cli.id} className="setting-row">
            <div className="setting-row-main">
              <div className="setting-row-title">{cli.displayName}</div>
              <div className="setting-row-desc mono">{cli.resolvedPath ?? cli.installHint}</div>
            </div>
            <span className={`badge ${cli.installed ? 'auth-logged-in' : 'auth-none'}`}>
              {cli.installed ? t('sidebar.installed') : t('sidebar.notInstalled')}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { settings, clis, applySettings } = useHubStore();
  const [page, setPage] = useState<PageId>('general');
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.hub.getAppInfo().then((i) => setVersion(i.version));
  }, []);
  if (!settings) return null;

  const setPath = (id: CliId, value: string) => {
    void applySettings({ customPaths: { ...settings.customPaths, [id]: value } });
  };

  const cliName = (id: CliId) => clis.find((c) => c.id === id)?.displayName ?? id;

  const NavItem = ({ id, icon, label }: { id: PageId; icon: React.ReactNode; label: string }) => (
    <button className={`settings-nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-settings">
        <button className="settings-close" aria-label={t('settings.close')} onClick={onClose}>
          <X size={15} />
        </button>
        <div className="settings-layout">
          <nav className="settings-nav">
            <div className="settings-brand">
              <span className="brand-badge" style={{ background: 'var(--fg)' }}>AI</span>
              <div>
                <div className="settings-brand-name">AI CLI Hub</div>
                <div className="settings-brand-ver">{version}</div>
              </div>
            </div>

            <NavItem id="general" icon={<Settings size={15} />} label={t('settings.tab.general')} />

            <div className="settings-nav-sep" />

            <NavItem id="modelProviders" icon={<Cpu size={15} />} label={t('settings.tab.modelProviders')} />
            <NavItem id="skills" icon={<Sparkles size={15} />} label={t('settings.tab.skills')} />
            <NavItem id="mcp" icon={<Plug size={15} />} label={t('settings.tab.mcp')} />
            <NavItem id="usage" icon={<BarChart3 size={15} />} label={t('settings.tab.usage')} />

            <div className="settings-nav-sep" />

            <NavItem id="cliSettings" icon={<Terminal size={15} />} label={t('settings.tab.cliSettings')} />

            <div className="settings-nav-sep" />
            <NavItem id="about" icon={<Info size={15} />} label={t('settings.tab.about')} />
          </nav>

          <div className="settings-content">
            {page === 'general' && (
              <div>
                <PageHeader title={t('settings.tab.general')} />
                <Section title={t('settings.appearance')} desc={t('settings.appearanceDesc')}>
                  <FormRow label={t('settings.language')} desc={t('settings.languageDesc')}>
                    <select
                      value={settings.language}
                      onChange={(e) => {
                        const language = e.target.value as Language;
                        void i18n.changeLanguage(language);
                        void applySettings({ language });
                      }}
                    >
                      <option value="zh">{t('lang.zh')}</option>
                      <option value="en">{t('lang.en')}</option>
                    </select>
                  </FormRow>
                  <FormRow label={t('settings.theme')} desc={t('settings.themeDesc')}>
                    <select
                      value={settings.theme}
                      onChange={(e) => void applySettings({ theme: e.target.value as ThemeMode })}
                    >
                      <option value="light">{t('settings.themeLight')}</option>
                      <option value="dark">{t('settings.themeDark')}</option>
                      <option value="system">{t('settings.themeSystem')}</option>
                    </select>
                  </FormRow>
                </Section>

                <Section title={t('settings.closeBehavior')} desc={t('settings.closeBehaviorDesc')}>
                  <FormRow label={t('settings.closeAction')} desc={t('settings.closeActionDesc')}>
                    <select
                      value={settings.closeBehavior ?? 'minimizeToTray'}
                      onChange={(e) => void applySettings({ closeBehavior: e.target.value as CloseBehavior })}
                    >
                      <option value="minimizeToTray">{t('settings.closeMinimizeToTray')}</option>
                      <option value="quit">{t('settings.closeQuit')}</option>
                    </select>
                  </FormRow>
                </Section>

                <Section title={t('settings.cliPaths')} desc={t('settings.cliPathsDesc')}>
                  {clis.map((cli) => {
                    const customPath = settings.customPaths[cli.id] ?? '';
                    return (
                      <FormRow
                        key={cli.id}
                        label={cli.displayName}
                        desc={cli.installed ? (cli.resolvedPath ?? undefined) : `${t('settings.installHint')}: ${cli.installHint}`}
                      >
                        <div className="cli-path-picker">
                          <span className="cli-path-display mono" title={customPath || t('settings.cliPathPlaceholder')}>
                            {customPath || t('settings.cliPathPlaceholder')}
                          </span>
                          <button
                            className="secondary cli-path-btn"
                            onClick={async () => {
                              const p = await window.hub.pickExecutable();
                              if (p) setPath(cli.id, p);
                            }}
                            title={t('settings.cliPathPick')}
                          >
                            <FolderOpen size={14} />
                          </button>
                          {customPath && (
                            <button
                              className="secondary cli-path-btn"
                              onClick={() => setPath(cli.id, '')}
                              title={t('settings.cliPathClear')}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </FormRow>
                    );
                  })}
                </Section>
              </div>
            )}

            {page === 'modelProviders' && <ModelProvidersTab />}
            {page === 'skills' && <SkillsTab />}
            {page === 'mcp' && <McpTab />}
            {page === 'usage' && <UsageTab />}
            {page === 'about' && <AboutPage />}
            {page === 'cliSettings' && (
              <CliListPage onOpen={(id) => setPage(`cli:${id}`)} />
            )}
            {page.startsWith('cli:') && (
              <CliSettingsPage cliId={page.slice(4) as CliId} onBack={() => setPage('cliSettings')} />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
