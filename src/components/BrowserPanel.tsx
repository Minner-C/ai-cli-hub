// 内置浏览器面板：<webview> 实现（多实例：每个标签页独立 webview）
// 工具栏：前进/后退/刷新/DevTools/选取元素/主页/外部打开
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Home, Code2, Crosshair } from 'lucide-react';
import { useHubStore } from '../store';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string;
        allowpopups?: string;
      }, HTMLElement>;
    }
  }
}

interface Props {
  url: string;
}

// 选取脚本（注入 webview）：hover 高亮、点击捕获、ESC 取消
const PICK_SCRIPT = `
new Promise((resolve) => {
  const prev = document.getElementById('__aih_pick_style');
  if (prev) prev.remove();
  const style = document.createElement('style');
  style.id = '__aih_pick_style';
  style.textContent = '.__aih_hover{outline:2px solid rgba(88,166,255,.8)!important;background:rgba(88,166,255,.12)!important;cursor:crosshair!important}';
  document.head.appendChild(style);
  let current = null;
  const cleanup = () => {
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (current) current.classList.remove('__aih_hover');
    const s = document.getElementById('__aih_pick_style');
    if (s) s.remove();
  };
  window.__aihUnpick = cleanup;
  const selectorOf = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
      if (cls) s += '.' + cls;
    }
    return s;
  };
  const onOver = (e) => {
    if (current) current.classList.remove('__aih_hover');
    current = e.target;
    current.classList.add('__aih_hover');
  };
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    cleanup();
    resolve({
      selector: selectorOf(el),
      outerHTML: (el.outerHTML || '').slice(0, 500),
      innerText: (el.innerText || '').slice(0, 200),
      url: location.href,
    });
  };
  const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
})
`;

export default function BrowserPanel({ url }: Props) {
  const { t } = useTranslation();
  const { setBrowserUrl, setPendingInsert } = useHubStore();
  const [address, setAddress] = useState(url);
  const viewRef = useRef<HTMLElement | null>(null);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setAddress(url);
    const view = viewRef.current as (HTMLElement & {
      loadURL?: (url: string) => void;
      canGoBack?: () => boolean;
      canGoForward?: () => boolean;
      addEventListener?: (type: string, fn: () => void) => void;
    }) | null;
    if (view?.loadURL) {
      if (url && view.getAttribute('src') !== url) {
        void view.loadURL(url);
      }
      const update = () => {
        setCanBack(Boolean(view.canGoBack?.()));
        setCanFwd(Boolean(view.canGoForward?.()));
      };
      view.addEventListener?.('did-navigate', update);
      view.addEventListener?.('did-navigate-in-page', update);
    }
  }, [url]);

  const nav = (u: string) => {
    const fixed = /^https?:\/\//.test(u) ? u : `https://${u}`;
    setBrowserUrl(fixed);
  };

  const execJs = (code: string): Promise<unknown> => {
    const v = viewRef.current as (HTMLElement & { executeJavaScript?: (c: string) => Promise<unknown> }) | null;
    return v?.executeJavaScript ? v.executeJavaScript(code) : Promise.resolve(null);
  };

  const togglePick = async () => {
    if (picking) {
      setPicking(false);
      await execJs('window.__aihUnpick && window.__aihUnpick()').catch(() => undefined);
      return;
    }
    setPicking(true);
    try {
      const result = await execJs(PICK_SCRIPT);
      setPicking(false);
      if (result && typeof result === 'object') {
        const info = result as { selector: string; outerHTML: string; innerText: string; url: string };
        const snippet = `来自 <${info.url}> 的元素 \`${info.selector}\`\n\`\`\`html\n${info.outerHTML}\n\`\`\``;
        setPendingInsert(snippet);
      }
    } catch {
      setPicking(false);
    }
  };

  const view = viewRef.current as (HTMLElement & {
    goBack?: () => void;
    goForward?: () => void;
    reload?: () => void;
    openDevTools?: () => void;
  }) | null;

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <button className="icon-btn" disabled={!canBack} onClick={() => view?.goBack?.()} title={t('browser.back')}>
          <ArrowLeft size={14} />
        </button>
        <button className="icon-btn" disabled={!canFwd} onClick={() => view?.goForward?.()} title={t('browser.forward')}>
          <ArrowRight size={14} />
        </button>
        <button className="icon-btn" onClick={() => view?.reload?.()} title={t('browser.reload')}>
          <RotateCw size={13} />
        </button>
        <input
          className="browser-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') nav(address.trim());
          }}
          placeholder={t('browser.addressPlaceholder')}
        />
        <button
          className="icon-btn"
          title={t('browser.devtools')}
          onClick={() => view?.openDevTools?.()}
        >
          <Code2 size={13} />
        </button>
        <button
          className={`icon-btn ${picking ? 'picking-active' : ''}`}
          title={t('browser.pick')}
          onClick={() => void togglePick()}
        >
          <Crosshair size={13} />
        </button>
        <button className="icon-btn" title={t('browser.home')} onClick={() => nav('https://www.bing.com')}>
          <Home size={13} />
        </button>
        <button
          className="icon-btn"
          title={t('browser.openExternal')}
          onClick={() => void window.hub.openExternal(url)}
        >
          <ExternalLink size={13} />
        </button>
      </div>
      <webview ref={viewRef} src={url || 'about:blank'} className="browser-view" />
    </div>
  );
}
