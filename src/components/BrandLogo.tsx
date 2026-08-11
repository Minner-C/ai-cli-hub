// 厂商 logo 组件：优先使用官方彩色 logo，降级到品牌色图标
// 资源优先级：icon.horse（彩色官方 logo）→ simple-icons（品牌色 SVG）→ 官网 favicon → 品牌色+首字母
import { useEffect, useState, type CSSProperties } from 'react';

interface BrandLogoProps {
  brand?: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

type IconSource =
  | { kind: 'brand-logo'; domain: string }
  | { kind: 'simple-icons'; slug: string }
  | { kind: 'favicon'; url: string };

// brand 字段别名 → 统一 brand key
const BRAND_ALIASES: Record<string, string> = {
  kimi: 'kimi', moonshot: 'kimi', 'kimi-moonshot': 'kimi',
  claude: 'claude', anthropic: 'claude',
  glm: 'glm', zhipu: 'glm', 'z.ai': 'glm', chatglm: 'glm',
  deepseek: 'deepseek',
  qwen: 'qwen', tongyi: 'qwen', 'qwen-plus': 'qwen', 'qwen-max': 'qwen', 'qwen-coder': 'qwen',
  gemini: 'gemini', google: 'gemini',
  codex: 'codex',
  openai: 'openai', gpt: 'openai', 'gpt-4': 'openai', 'gpt-4o': 'openai', 'gpt-5': 'openai',
  doubao: 'doubao', bytedance: 'doubao',
  volcengine: 'volcengine', 火山引擎: 'volcengine', 火山: 'volcengine',
  baichuan: 'baichuan',
  minimax: 'minimax',
  yi: 'yi', '01-ai': 'yi',
  stepfun: 'stepfun', step: 'stepfun',
  opencode: 'opencode',
  aider: 'aider',
  pi: 'pi',
  hermes: 'hermes',
};

// 各品牌 logo 资源映射（按优先级尝试，失败自动降级）
// - brand-logo: 通过 icon.horse 获取彩色官方 logo（最接近官方视觉）
// - simple-icons: simpleicons.org CDN（品牌色单色 SVG）
// - favicon: 品牌官网 favicon（兜底）
const BRAND_SOURCES: Record<string, IconSource[]> = {
  kimi: [
    { kind: 'brand-logo', domain: 'moonshot.cn' },
    { kind: 'simple-icons', slug: 'moonshotai' },
  ],
  claude: [
    { kind: 'brand-logo', domain: 'anthropic.com' },
    { kind: 'simple-icons', slug: 'claude' },
  ],
  deepseek: [
    { kind: 'brand-logo', domain: 'deepseek.com' },
    { kind: 'simple-icons', slug: 'deepseek' },
  ],
  qwen: [
    { kind: 'brand-logo', domain: 'qwenlm.ai' },
    { kind: 'simple-icons', slug: 'qwen' },
  ],
  gemini: [
    { kind: 'brand-logo', domain: 'gemini.google.com' },
    { kind: 'simple-icons', slug: 'googlegemini' },
  ],
  openai: [
    { kind: 'brand-logo', domain: 'openai.com' },
    { kind: 'favicon', url: 'https://openai.com/favicon.ico' },
  ],
  codex: [
    { kind: 'brand-logo', domain: 'openai.com' },
    { kind: 'favicon', url: 'https://openai.com/favicon.ico' },
  ],
  glm: [
    { kind: 'brand-logo', domain: 'bigmodel.cn' },
    { kind: 'favicon', url: 'https://open.bigmodel.cn/favicon.ico' },
  ],
  doubao: [
    { kind: 'brand-logo', domain: 'doubao.com' },
    { kind: 'simple-icons', slug: 'bytedance' },
  ],
  volcengine: [
    { kind: 'brand-logo', domain: 'volcengine.com' },
  ],
  minimax: [
    { kind: 'brand-logo', domain: 'minimaxi.com' },
    { kind: 'simple-icons', slug: 'minimax' },
  ],
  baichuan: [
    { kind: 'brand-logo', domain: 'baichuan-ai.com' },
    { kind: 'favicon', url: 'https://www.baichuan-ai.com/favicon.ico' },
  ],
  yi: [
    { kind: 'brand-logo', domain: 'lingyiwanwu.com' },
    { kind: 'favicon', url: 'https://www.lingyiwanwu.com/favicon.ico' },
  ],
  stepfun: [
    { kind: 'brand-logo', domain: 'stepfun.com' },
    { kind: 'favicon', url: 'https://www.stepfun.com/favicon.ico' },
  ],
  opencode: [
    { kind: 'brand-logo', domain: 'opencode.ai' },
    { kind: 'favicon', url: 'https://opencode.ai/favicon.ico' },
  ],
  aider: [
    { kind: 'brand-logo', domain: 'aider.chat' },
    { kind: 'favicon', url: 'https://aider.chat/favicon.ico' },
  ],
  pi: [
    { kind: 'brand-logo', domain: 'pi.ai' },
    { kind: 'favicon', url: 'https://pi.ai/favicon.ico' },
  ],
  hermes: [
    { kind: 'brand-logo', domain: 'nousresearch.com' },
    { kind: 'favicon', url: 'https://hermes-agent.nousresearch.com/favicon.ico' },
  ],
};

// 兜底品牌色（所有在线资源都加载失败时用）
const FALLBACK_COLORS: Record<string, string> = {
  kimi: '#6C5CE7',
  claude: '#D97757',
  glm: '#0EA5E9',
  deepseek: '#4D6BFE',
  qwen: '#7C3AED',
  gemini: '#0EA5E9',
  codex: '#10A37F',
  openai: '#10A37F',
  doubao: '#FF6B35',
  volcengine: '#1664FF',
  baichuan: '#1F2937',
  minimax: '#000000',
  yi: '#00B8A9',
  stepfun: '#FFD166',
  opencode: '#F97316',
  aider: '#FF6B35',
  pi: '#8B5CF6',
  hermes: '#D4A853',
};

function buildImageUrl(source: IconSource): string {
  switch (source.kind) {
    case 'brand-logo':
      // icon.horse 支持官方彩色 logo，size 参数请求合适尺寸
      return `https://icon.horse/icon/${source.domain}?size=64`;
    case 'simple-icons':
      return `https://cdn.simpleicons.org/${source.slug}`;
    case 'favicon':
      return source.url;
  }
}

// 检测是否为暗色主题（跟随系统 data-theme 属性）
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export default function BrandLogo({ brand, size = 20, style, className }: BrandLogoProps) {
  const [erroredIndex, setErroredIndex] = useState<number>(-1);
  const [dark, setDark] = useState<boolean>(() => isDarkTheme());

  // 主题变化时重新检测（响应 data-theme 切换）
  useEffect(() => {
    const check = () => setDark(isDarkTheme());
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    mql?.addEventListener?.('change', check);
    return () => {
      mo.disconnect();
      mql?.removeEventListener?.('change', check);
    };
  }, []);

  // brand 变化时重置错误状态
  useEffect(() => {
    setErroredIndex(-1);
  }, [brand]);

  const normalized = brand ? brand.toLowerCase() : '';
  const key = normalized ? BRAND_ALIASES[normalized] ?? normalized : '';
  const sources = key ? BRAND_SOURCES[key] : null;

  // 找到第一个还没失败的资源
  const currentSource = sources?.find((_, i) => i > erroredIndex) ?? null;

  // 所有资源都失败或无资源：回退品牌色 + 首字母
  if (!currentSource) {
    const letter = (brand ?? '?').slice(0, 1).toUpperCase();
    const color = key ? FALLBACK_COLORS[key] ?? 'var(--fg-muted)' : 'var(--fg-muted)';
    return (
      <span
        className={`brand-badge ${className ?? ''}`}
        style={{ background: color, width: size, height: size, fontSize: size * 0.55, ...style }}
      >
        {letter}
      </span>
    );
  }

  // brand-logo 类型：返回彩色 logo，通常自带完整视觉，透明背景即可
  // simple-icons 类型：品牌色 SVG，透明背景
  // favicon 类型：需加底色 chip 确保在两种主题下都可见
  const isFavicon = currentSource.kind === 'favicon';
  const pad = Math.max(2, Math.round(size * 0.15));
  // favicon 底色：暗色模式用深灰，亮色模式用白
  const chipBg = dark ? '#2a2a2c' : '#ffffff';
  const chipBorder = dark ? '#3a3a3c' : '#e5e5e7';

  return (
    <span
      className={`brand-logo-wrap ${className ?? ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.max(3, Math.round(size * 0.22)),
        background: isFavicon ? chipBg : 'transparent',
        border: isFavicon ? `1px solid ${chipBorder}` : 'none',
        ...style,
      }}
    >
      <img
        src={buildImageUrl(currentSource)}
        width={isFavicon ? size - pad * 2 : size}
        height={isFavicon ? size - pad * 2 : size}
        alt={brand ?? ''}
        onError={() => setErroredIndex(sources!.indexOf(currentSource))}
        style={{
          width: isFavicon ? size - pad * 2 : size,
          height: isFavicon ? size - pad * 2 : size,
          objectFit: 'contain',
        }}
      />
    </span>
  );
}
