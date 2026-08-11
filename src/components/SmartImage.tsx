// 智能图片：按 src 形态加载——http(s)/data: 直接用；本地路径经 IPC 读文件转 dataUrl
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  src: string;
  alt?: string;
  cwd?: string;
  onZoom?: (dataUrl: string) => void;
  className?: string;
}

export default function SmartImage({ src, alt, cwd, onZoom, className }: Props) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDataUrl(null);
    setFailed(false);
    // http(s) / data: 直接用
    if (/^https?:\/\//.test(src) || src.startsWith('data:')) {
      setDataUrl(src);
      return;
    }
    let cancelled = false;
    window.hub
      .readFilePreview(src, cwd)
      .then((preview) => {
        if (cancelled) return;
        if (preview && preview.kind === 'image' && preview.dataUrl) setDataUrl(preview.dataUrl);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [src, cwd]);

  if (failed) return <code className="mono hint">{src}</code>;
  if (!dataUrl) return <span className="hint image-loading">{t('image.loading')}</span>;
  return (
    <img
      className={className ?? 'smart-image'}
      src={dataUrl}
      alt={alt ?? src}
      onError={() => setFailed(true)}
      onClick={() => onZoom?.(dataUrl)}
    />
  );
}

// 判断路径是否图片扩展名
export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(p);
}

// 判断文本是否为 data:image base64 长串
export function isDataImage(text: string): boolean {
  return /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]{100,}$/.test(text.trim());
}
