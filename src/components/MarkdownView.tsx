// Markdown 渲染：GFM + 代码高亮 + 智能图片（本地路径/dataUrl/http）
import { memo, useRef, useState, isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { Copy, Check } from 'lucide-react';
import SmartImage, { isDataImage } from './SmartImage';
import { cleanDisplayText, normalizeMarkdown } from '../utils/displayText';
import { useHubStore } from '../store';

// 代码块：语言标签 + 一键复制
function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  // 语言标签：取 code 元素的 language-xxx 类名
  let lang = '';
  if (isValidElement<{ className?: string }>(children)) {
    const m = /language-(\w+)/.exec(children.props.className ?? '');
    lang = m?.[1] ?? '';
  }
  const copy = async () => {
    const text = (preRef.current?.textContent ?? '').replace(/\n$/, '');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板失败兜底
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || 'code'}</span>
        <button className="code-copy" onClick={() => void copy()}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('chat.copied') : t('chat.copy')}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

export default memo(function MarkdownView({ text, cwd, onImageClick }: { text: string; cwd?: string; onImageClick?: (dataUrl: string) => void }) {
  const cleaned = normalizeMarkdown(cleanDisplayText(text));
  // 整块内容就是一条 data:image base64 → 直接渲染图片
  if (isDataImage(cleaned)) {
    return <SmartImage src={cleaned} onZoom={onImageClick} />;
  }
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          img: ({ src, alt }) => (
            <SmartImage src={typeof src === 'string' ? src : ''} alt={alt} cwd={cwd} onZoom={onImageClick} />
          ),
          // 拦截链接点击：http(s) 链接进右侧内置浏览器（未开右栏则自动开），
          // 主窗口永不被导航走
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                if (!href) return;
                const isInternal = href.startsWith('#') ||
                  href.startsWith('file://') ||
                  href.startsWith('http://localhost') ||
                  href.startsWith('http://127.0.0.1');
                if (!isInternal) {
                  e.preventDefault();
                  e.stopPropagation();
                  // setBrowserUrl 会自动打开右栏浏览器 tab
                  useHubStore.getState().setBrowserUrl(href);
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});
