// 文件预览面板：按文件类型自动展示
// - 图片：图片预览
// - 视频：视频播放
// - HTML：浏览器中打开（工具栏按钮）
// - 文本/代码：Monaco 编辑器（可编辑保存）
// - 二进制：提示
// 多实例：每个标签页独立实例，接收 path/cwd/tabId 作为 props
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor, { type OnMount } from '@monaco-editor/react';
import { X, ExternalLink, Save, Undo2, Globe } from 'lucide-react';
import { useHubStore } from '../store';
import type { FilePreview } from '../../electron/filePreview';

// 文件扩展名 -> Monaco 语言 ID 映射
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown',
  py: 'python',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', conf: 'ini',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'cpp',
  sql: 'sql', dockerfile: 'dockerfile',
};

function extOf(p: string): string {
  const m = p.match(/\.(\w+)$/);
  return m ? m[1].toLowerCase() : '';
}

function monacoLang(p: string): string {
  const ext = extOf(p);
  if (ext === '' && /dockerfile$/i.test(p)) return 'dockerfile';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

interface Props {
  embedded?: boolean;
  path: string;
  cwd?: string;
  tabId: string;
}

export default function FilePreviewPanel({ embedded = false, path, cwd, tabId }: Props) {
  const { t } = useTranslation();
  const { setBrowserUrl, setError, closeRightTab } = useHubStore();
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [editText, setEditText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const saveFnRef = useRef<() => void>(() => {});

  // 跟随应用主题（data-theme 属性）切换 Monaco 主题
  const [monacoTheme, setMonacoTheme] = useState<'vs-dark' | 'light'>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'vs-dark',
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const th = document.documentElement.getAttribute('data-theme');
      setMonacoTheme(th === 'light' ? 'light' : 'vs-dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoTheme);
  }, [monacoTheme]);

  // 读取文件预览
  useEffect(() => {
    if (!path) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void window.hub.readFilePreview(path, cwd).then((p) => {
      if (cancelled) return;
      setPreview(p);
      setDirty(false);
      if (p.kind === 'text') setEditText(p.content);
    });
    return () => {
      cancelled = true;
    };
  }, [path, cwd]);

  const save = useCallback(async () => {
    if (!path) return;
    setSaving(true);
    try {
      const res = await window.hub.writeFile(path, editText, cwd);
      if (!res.ok) {
        setError(res.message ?? t('preview.saveFailed'));
        return;
      }
      const fresh = await window.hub.readFilePreview(path, cwd);
      setPreview(fresh);
      if (fresh.kind === 'text') setEditText(fresh.content);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [path, editText, cwd, setError, t]);

  saveFnRef.current = save;

  const onEditChange = (v: string | undefined) => {
    setEditText(v ?? '');
    setDirty((v ?? '') !== (preview?.kind === 'text' ? preview.content : ''));
  };

  const discard = () => {
    setEditText(preview?.kind === 'text' ? preview.content : '');
    setDirty(false);
  };

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveFnRef.current();
    });
    // tab 内容默认 display:none 渲染，Monaco 挂载时量到 0 尺寸（5x5 不再增长）——
    // 挂载后与容器尺寸变化时强制重排
    const relayout = () => editor.layout();
    requestAnimationFrame(relayout);
    setTimeout(relayout, 100);
    setTimeout(relayout, 400);
    const ro = new ResizeObserver(relayout);
    ro.observe(editor.getContainerDomNode());
  };

  if (!path) {
    return embedded ? <div className="empty-state">{t('files.noPreview')}</div> : null;
  }

  const isText = preview?.kind === 'text';
  const isImage = preview?.kind === 'image';
  const isVideo = preview?.kind === 'video';
  const isHtml = /\.html?$/i.test(path);
  const canEdit = isText && !preview?.truncated;

  return (
    <div className="preview-panel">
      <div className="preview-head">
        <span className="preview-path" title={path}>
          {path}
        </span>
        {canEdit && (
          <>
            <button
              className="icon-btn"
              title={t('auth.save') + ' (Ctrl+S)'}
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              <Save size={14} />
            </button>
            <button
              className="icon-btn"
              title={t('preview.discard')}
              disabled={saving || !dirty}
              onClick={discard}
            >
              <Undo2 size={14} />
            </button>
            {dirty && <span className="preview-dirty">{t('preview.unsaved')}</span>}
          </>
        )}
        {isHtml && (
          <button
            className="icon-btn"
            title={t('preview.inBrowser')}
            onClick={() => setBrowserUrl('file:///' + path.replace(/\\/g, '/').replace(/^\//, ''))}
          >
            <Globe size={15} />
          </button>
        )}
        <button
          className="icon-btn"
          title={t('preview.openExternal')}
          onClick={() => void window.hub.openPath(path, cwd)}
        >
          <ExternalLink size={15} />
        </button>
        <button className="icon-btn" title={t('settings.close')} onClick={() => closeRightTab(tabId)}>
          <X size={15} />
        </button>
      </div>

      <div className={`preview-body ${isText ? 'edit-mode' : ''}`}>
        {!preview && <div className="hint">…</div>}
        {preview?.kind === 'error' && (
          <div className="hint">{t('preview.error')}: {preview.message}</div>
        )}
        {preview?.kind === 'binary' && <div className="hint">{t('preview.binary')}</div>}
        {isImage && (
          <div className="preview-image-wrap">
            <img className="preview-img" src={preview.dataUrl} alt={path} />
          </div>
        )}
        {isVideo && (
          <div className="preview-video-wrap">
            <video className="preview-video" src={preview.path} controls autoPlay loop />
          </div>
        )}
        {isText && canEdit && (
          <Editor
            className="preview-monaco"
            language={monacoLang(path)}
            value={editText}
            theme={monacoTheme}
            options={{
              readOnly: saving,
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 20,
              tabSize: 2,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
              padding: { top: 8, bottom: 8 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              formatOnPaste: true,
            }}
            onChange={onEditChange}
            onMount={onMount}
          />
        )}
        {isText && !canEdit && (
          <>
            <pre className="preview-code preview-source">{preview.content}</pre>
            <div className="hint">{t('preview.truncated')}</div>
          </>
        )}
      </div>
    </div>
  );
}
