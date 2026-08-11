// 内置浏览器面板：<webview> 实现（多实例：每个标签页独立 webview）
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Home } from 'lucide-react';
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

export default function BrowserPanel({ url }: Props) {
  const { t } = useTranslation();
  const { setBrowserUrl } = useHubStore();
  const [address, setAddress] = useState(url);
  const viewRef = useRef<HTMLElement | null>(null);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

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

  const view = viewRef.current as (HTMLElement & {
    goBack?: () => void;
    goForward?: () => void;
    reload?: () => void;
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
