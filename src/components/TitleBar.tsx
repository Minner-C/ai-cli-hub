// 自定义标题栏：替代 Windows 原生顶栏
// 左：logo + 应用名 + 侧边栏收起/展开按钮
// 右：最小化 / 最大化(还原) / 关闭
// 整条可拖拽（-webkit-app-region: drag），按钮设为 no-drag
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Copy, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function TitleBar({ sidebarOpen, onToggleSidebar }: TitleBarProps) {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.hub.winIsMaximized().then(setMaximized);
    const off = window.hub.onMaximizeChange(setMaximized);
    return off;
  }, []);

  return (
    <div className="title-bar">
      {/* 左侧：logo + 名称 + 侧边栏折叠按钮 */}
      <div className="title-bar-left">
        <span className="title-bar-logo">AI</span>
        <span className="title-bar-name">AI CLI Hub</span>
        <button
          className="title-bar-btn sidebar-toggle"
          onClick={onToggleSidebar}
          title={sidebarOpen ? t('panel.collapseLeft') : t('panel.expandLeft')}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {/* 中间留白（拖拽区） */}
      <div className="title-bar-drag" />

      {/* 右侧：窗口控制按钮 */}
      <div className="title-bar-controls">
        <button
          className="title-bar-btn win-btn"
          onClick={() => void window.hub.winMinimize()}
          title={t('titlebar.minimize')}
        >
          <Minus size={16} />
        </button>
        <button
          className="title-bar-btn win-btn"
          onClick={() => void window.hub.winMaximizeToggle()}
          title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        >
          {maximized ? <Copy size={14} /> : <Square size={13} />}
        </button>
        <button
          className="title-bar-btn win-btn win-close"
          onClick={() => void window.hub.winClose()}
          title={t('titlebar.close')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
