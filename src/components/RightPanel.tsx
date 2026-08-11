// 右栏：多标签页（预览 + 浏览器混合），可同时打开多个文件/网页
// 标签栏横向滚动，每个标签可关闭；内容区按 activeTab.kind 渲染
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Globe, FileText } from 'lucide-react';
import { useHubStore, type RightTab } from '../store';
import BrowserPanel from './BrowserPanel';
import FilePreviewPanel from './FilePreviewPanel';

const MIN_W = 280;
// 最大宽度动态取窗口宽度的 85%，留至少 15% 给中栏；下限 1400 保证大屏可用
const getMaxW = () => Math.max(1400, Math.floor(window.innerWidth * 0.85));
const DEFAULT_W = 460;
// 左侧任务栏宽度（与 CSS .sidebar width 一致）
const SIDEBAR_W = 248;

export default function RightPanel({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { t } = useTranslation();
  const {
    rightTabs,
    activeRightTabId,
    setActiveRightTab,
    closeRightTab,
    setBrowserUrl,
    rightPanelOpen,
    setRightPanelOpen,
  } = useHubStore();
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('rightPanelWidth'));
    return saved >= MIN_W && saved <= getMaxW() ? saved : DEFAULT_W;
  });
  const [showAddress, setShowAddress] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  // 跟踪上一次侧栏状态，折叠/展开时由右栏吸收宽度变化，避免挤压对话栏
  const prevSidebarOpen = useRef(sidebarOpen);

  // 侧栏折叠/展开时：右栏反向调整同等宽度，保持中栏（对话区）宽度稳定
  useEffect(() => {
    if (prevSidebarOpen.current === sidebarOpen) return;
    const delta = sidebarOpen ? -SIDEBAR_W : SIDEBAR_W;
    setWidth((w) => {
      const next = Math.min(getMaxW(), Math.max(MIN_W, w + delta));
      localStorage.setItem('rightPanelWidth', String(next));
      return next;
    });
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  // 拖拽分隔条
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { startX: e.clientX, startW: width };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const next = Math.min(getMaxW(), Math.max(MIN_W, dragRef.current.startW - (ev.clientX - dragRef.current.startX)));
        setWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        if (dragRef.current) {
          const next = Math.min(getMaxW(), Math.max(MIN_W, dragRef.current.startW - (ev.clientX - dragRef.current.startX)));
          localStorage.setItem('rightPanelWidth', String(next));
        }
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width],
  );

  if (!rightPanelOpen) return null;

  const activeTab = rightTabs.find((t) => t.id === activeRightTabId) ?? null;

  const openAddress = () => {
    setShowAddress(true);
    setAddressInput('');
  };

  const submitAddress = () => {
    const url = addressInput.trim();
    if (url) {
      const fixed = /^https?:\/\//.test(url) ? url : `https://${url}`;
      setBrowserUrl(fixed);
    }
    setShowAddress(false);
  };

  return (
    <div className="right-panel-wrap" style={{ width }}>
      <div className="right-panel-resizer" onMouseDown={onDragStart} />
      <div className="right-panel">
        {/* 标签栏：横向滚动，每个标签含图标+标题+关闭按钮 */}
        <div className="right-panel-tabs">
          <div className="right-tabs-scroll">
            {rightTabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                active={tab.id === activeRightTabId}
                onClick={() => setActiveRightTab(tab.id)}
                onClose={() => closeRightTab(tab.id)}
              />
            ))}
            {/* 新建浏览器标签按钮 */}
            <button className="right-tab-add" onClick={openAddress} title={t('browser.newTab')}>
              <Plus size={14} />
            </button>
          </div>
          <button className="icon-btn right-panel-close" onClick={() => setRightPanelOpen(false)} title={t('panel.collapseRight')}>
            ▸
          </button>
        </div>

        {/* 地址栏输入（仅点击 + 时显示） */}
        {showAddress && (
          <div className="right-address-bar">
            <Globe size={13} className="hint" />
            <input
              autoFocus
              className="right-address-input"
              value={addressInput}
              placeholder={t('browser.addressPlaceholder')}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAddress();
                if (e.key === 'Escape') setShowAddress(false);
              }}
              onBlur={() => setShowAddress(false)}
            />
          </div>
        )}

        {/* 内容区：所有 tab 都渲染，用 CSS 控制可见性以保留 webview 会话和编辑态 */}
        <div className="right-panel-content">
          {rightTabs.length === 0 && (
            <div className="empty-state">
              <div style={{ textAlign: 'center' }}>
                <FileText size={32} className="hint" style={{ marginBottom: 8 }} />
                <p className="hint">{t('panel.emptyHint')}</p>
              </div>
            </div>
          )}
          {rightTabs.map((tab) => (
            <div
              key={tab.id}
              className="right-tab-content"
              style={{ display: tab.id === activeRightTabId ? 'flex' : 'none' }}
            >
              {tab.kind === 'browser' ? (
                <BrowserPanel url={tab.url} />
              ) : (
                <FilePreviewPanel embedded path={tab.path} cwd={tab.cwd} tabId={tab.id} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabItem({
  tab,
  active,
  onClick,
  onClose,
}: {
  tab: RightTab;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <div className={`right-tab ${active ? 'active' : ''}`} onClick={onClick} title={tab.kind === 'preview' ? tab.path : tab.url}>
      {tab.kind === 'browser' ? <Globe size={12} /> : <FileText size={12} />}
      <span className="right-tab-title">{tab.title}</span>
      <button
        className="right-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}
