// 右栏：多标签页（预览 + 浏览器混合），可同时打开多个文件/网页
// 标签栏横向滚动，每个标签可关闭；内容区按 activeTab.kind 渲染
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Globe, FileText, PanelsTopLeft, FlaskConical } from 'lucide-react';
import { useHubStore, type RightTab } from '../store';
import BrowserPanel from './BrowserPanel';
import TestPanel from './TestPanel';
import FilePreviewPanel from './FilePreviewPanel';

const MIN_W = 280;
// 对话区最小宽度：小于此宽度输入栏元素会被挤压变形（模型名换行、发送按钮变形）
const CHAT_MIN_W = 520;
// 最大宽度 = 窗口宽 - 侧栏（收起时为 0）- 对话区最小宽度
const getMaxW = (sidebarOpen: boolean) =>
  Math.max(MIN_W, window.innerWidth - (sidebarOpen ? SIDEBAR_W : 0) - CHAT_MIN_W);
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
    return saved >= MIN_W && saved <= getMaxW(sidebarOpen) ? saved : DEFAULT_W;
  });
  const [showAddress, setShowAddress] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 跟踪上一次侧栏状态与实际补偿量（展开时只回收实际补出去的量，避免过缩）
  const prevSidebarOpen = useRef(sidebarOpen);
  const lastComp = useRef(0);

  // 侧栏折叠/展开时：右栏吸收/回收宽度变化，保持中栏（对话区）宽度稳定
  useEffect(() => {
    if (prevSidebarOpen.current === sidebarOpen) return;
    const expanding = sidebarOpen; // true=展开侧栏（回收），false=收起侧栏（补偿）
    setWidth((w) => {
      const maxW = getMaxW(sidebarOpen);
      let next: number;
      if (expanding) {
        // 展开：回收上次实际补偿的量
        next = Math.max(MIN_W, w - lastComp.current);
        lastComp.current = 0;
      } else {
        // 收起：补偿侧栏宽度（不超过新上限），记录实际补偿量
        next = Math.min(maxW, w + SIDEBAR_W);
        lastComp.current = next - w;
      }
      localStorage.setItem('rightPanelWidth', String(next));
      return next;
    });
    prevSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  // 拖拽分隔条
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { startX: e.clientX, startW: width };
      setDragging(true);
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const next = Math.min(getMaxW(sidebarOpen), Math.max(MIN_W, dragRef.current.startW - (ev.clientX - dragRef.current.startX)));
        setWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        if (dragRef.current) {
          const next = Math.min(getMaxW(sidebarOpen), Math.max(MIN_W, dragRef.current.startW - (ev.clientX - dragRef.current.startX)));
          localStorage.setItem('rightPanelWidth', String(next));
        }
        dragRef.current = null;
        setDragging(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width],
  );

  // 响应式守卫：
  // ① 实时收窄——CSS clamp（width: clamp(280px, var(--right-w), calc(100vw - 768px))）无需事件监听，100vw 实时
  // ② 自动收起/恢复——matchMedia（视口变化可靠触发，比 window resize 稳）
  const userOpenRef = useRef(rightPanelOpen);
  const autoCollapsedRef = useRef(false);
  useEffect(() => {
    userOpenRef.current = rightPanelOpen;
    if (rightPanelOpen) autoCollapsedRef.current = false;
  }, [rightPanelOpen]);

  useEffect(() => {
    // 侧栏 248 + 对话最小 520 + 右栏最小 280 = 1048px 是底线
    const narrow = window.matchMedia(`(max-width: ${SIDEBAR_W + CHAT_MIN_W + MIN_W}px)`);
    const wide = window.matchMedia(`(min-width: ${SIDEBAR_W + CHAT_MIN_W + DEFAULT_W}px)`);
    const onNarrow = (e: MediaQueryListEvent) => {
      if (e.matches && rightPanelOpen) {
        autoCollapsedRef.current = true;
        setRightPanelOpen(false);
      }
    };
    const onWide = (e: MediaQueryListEvent) => {
      if (e.matches && autoCollapsedRef.current && userOpenRef.current) {
        autoCollapsedRef.current = false;
        setRightPanelOpen(true);
      }
    };
    narrow.addEventListener('change', onNarrow);
    wide.addEventListener('change', onWide);
    // 初始校正
    if (narrow.matches && rightPanelOpen) {
      autoCollapsedRef.current = true;
      setRightPanelOpen(false);
    }
    return () => {
      narrow.removeEventListener('change', onNarrow);
      wide.removeEventListener('change', onWide);
    };
  }, [rightPanelOpen, sidebarOpen, setRightPanelOpen]);

  // 窗口缩放宽度分配：预览栏展开时，窗口增宽的量补给预览栏（对话区宽度不变）；
  // 预览栏关闭时由对话区（flex）自然吸收
  useEffect(() => {
    let prevW = window.innerWidth;
    const onResize = () => {
      const w = window.innerWidth;
      const delta = w - prevW;
      prevW = w;
      if (!rightPanelOpen || delta === 0) return;
      setWidth((cur) => {
        const next = Math.min(getMaxW(sidebarOpen), Math.max(MIN_W, cur + delta));
        localStorage.setItem('rightPanelWidth', String(next));
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rightPanelOpen, sidebarOpen]);

  // 收起时不卸载（保留 tab/webview 状态），宽度 0 + CSS 隐藏内容
  const effectiveWidth = rightPanelOpen ? width : 0;

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
    <div
      className={`right-panel-wrap ${rightPanelOpen ? '' : 'collapsed'} ${dragging ? 'dragging' : ''}`}
      style={{
        '--right-w': effectiveWidth + 'px',
        '--right-max': getMaxW(sidebarOpen) + 'px',
      } as React.CSSProperties}
    >
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
            {/* 自动化测试入口 */}
            <button className="right-tab-add" onClick={() => useHubStore.getState().openTestTab()} title={t('test.open')}>
              <FlaskConical size={14} />
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
            <div className="empty-state panel-empty">
              <div className="panel-empty-icon">
                <PanelsTopLeft size={30} strokeWidth={1.5} />
              </div>
              <p className="panel-empty-title">{t('panel.emptyTitle')}</p>
              <p className="hint panel-empty-desc">{t('panel.emptyDesc')}</p>
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
              ) : tab.kind === 'test' ? (
                <TestTabContent />
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
    <div className={`right-tab ${active ? 'active' : ''}`} onClick={onClick} title={tab.kind === 'preview' ? tab.path : tab.kind === 'browser' ? tab.url : tab.title}>
      {tab.kind === 'browser' ? <Globe size={12} /> : tab.kind === 'test' ? <FlaskConical size={12} /> : <FileText size={12} />}
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

// 测试 tab 内容：从 store 取当前任务
function TestTabContent() {
  const { tasks, activeTaskId } = useHubStore();
  const task = tasks.find((t) => t.id === activeTaskId) ?? null;
  if (!task) return <div className="empty-state">—</div>;
  return <TestPanel task={task} />;
}
