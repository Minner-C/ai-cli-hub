// Markdown 渲染：GFM + 代码高亮 + 智能图片（本地路径/dataUrl/http）
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import SmartImage, { isDataImage } from './SmartImage';
import { cleanDisplayText } from '../utils/displayText';

export default memo(function MarkdownView({ text, cwd, onImageClick }: { text: string; cwd?: string; onImageClick?: (dataUrl: string) => void }) {
  const cleaned = cleanDisplayText(text);
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
          img: ({ src, alt }) => (
            <SmartImage src={typeof src === 'string' ? src : ''} alt={alt} cwd={cwd} onZoom={onImageClick} />
          ),
          // 拦截链接点击：外部链接改用系统默认浏览器打开，
          // 避免 Electron 窗口被导航成"浏览器"（与主进程 will-navigate 兜底一致）
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!href) return;
                const isInternal = href.startsWith('#') ||
                  href.startsWith('file://') ||
                  href.startsWith('http://localhost') ||
                  href.startsWith('http://127.0.0.1');
                if (!isInternal) {
                  e.preventDefault();
                  e.stopPropagation();
                  void window.hub.openExternal(href);
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
