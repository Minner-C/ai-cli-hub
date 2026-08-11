// 应用根组件：自定义标题栏 + 三栏布局（左任务栏 / 中对话区 / 右面板）+ 主题语言同步
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubStore } from './store';
import TitleBar from './components/TitleBar';
import TaskSidebar from './components/TaskSidebar';
import ChatView from './components/ChatView';
import RightPanel from './components/RightPanel';
import SettingsPanel from './components/SettingsPanel';
import NewChatDialog from './components/NewChatDialog';
import type { AppSettings } from '../electron/shared';
import './theme/theme.css';
import './app.css';

export default function App() {
  const { t, i18n } = useTranslation();
  const {
    init,
    settings,
    tasks,
    activeTaskId,
    settingsOpen,
    setSettingsOpen,
    applySettings,
    error,
    setError,
  } = useHubStore();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebarOpen') !== '0');

  // 启动时加载数据与设置
  useEffect(() => {
    void init();
  }, [init]);

  // 设置加载后同步 i18n 与主题
  useEffect(() => {
    if (!settings) return;
    void i18n.changeLanguage(settings.language);
    const root = document.documentElement;
    if (settings.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', settings.theme);
    }
  }, [settings, i18n]);

  // 原生菜单动作：新增对话 / 设置 / 主题 / 语言
  useEffect(() => {
    const off = window.hub.onMenuAction((action, payload) => {
      switch (action) {
        case 'menu:newChat':
          setNewChatOpen(true);
          break;
        case 'menu:openSettings':
          setSettingsOpen(true);
          break;
        case 'menu:setTheme':
          void applySettings({ theme: payload as AppSettings['theme'] });
          break;
        case 'menu:setLanguage': {
          const language = payload as AppSettings['language'];
          void i18n.changeLanguage(language);
          void applySettings({ language });
          break;
        }
      }
    });
    return off;
  }, [applySettings, setSettingsOpen, i18n]);

  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      localStorage.setItem('sidebarOpen', v ? '0' : '1');
      return !v;
    });
  };

  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;

  return (
    <div className="app-root">
      {/* 自定义标题栏：logo + 折叠按钮 + 窗口控制 */}
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />

      <div className="app">
        {/* 左栏：任务列表（可收起），收起态留空（折叠按钮已在标题栏） */}
        {sidebarOpen ? (
          <div className="sidebar-wrap">
            <TaskSidebar onNewChat={() => setNewChatOpen(true)} />
          </div>
        ) : null}

        {/* 中栏：对话区 */}
        <div className="main">
          {activeTask ? (
            <ChatView task={activeTask} />
          ) : (
            <div className="empty-state">
              <div style={{ textAlign: 'center' }}>
                <p>{t('app.noSession')}</p>
                <button onClick={() => setNewChatOpen(true)}>＋ {t('app.newChat')}</button>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：浏览器 / 预览 */}
        <RightPanel sidebarOpen={sidebarOpen} />
      </div>

      {newChatOpen && <NewChatDialog onClose={() => setNewChatOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {error && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>{t('app.errorTitle')}</h2>
            <div className="summary-preview">{error}</div>
            <div className="dialog-actions">
              <button onClick={() => setError(null)}>{t('app.ok')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
