// 轮次快速定位：聊天区右缘刻度条，悬停展开轮次列表，点击跳转
// 只显示当前轮次上下各 NEIGHBOR 轮，跟随滚动位置滑动
import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export interface Round {
  id: string;
  title: string;
}

const NEIGHBOR = 5;

export default function RoundNav({
  rounds,
  containerRef,
}: {
  rounds: Round[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 跟踪当前滚动位置对应哪一轮
  useEffect(() => {
    const el = containerRef.current;
    if (!el || rounds.length === 0) return;
    const onScroll = () => {
      let current: string | null = null;
      for (const r of rounds) {
        const node = el.querySelector(`[data-mid="${r.id}"]`);
        if (node && (node as HTMLElement).offsetTop <= el.scrollTop + el.clientHeight / 3) {
          current = r.id;
        }
      }
      setActiveId(current);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [rounds, containerRef]);

  // 点击外部收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 以当前轮次为中心，上下各 NEIGHBOR 轮的窗口
  const windowed = useMemo(() => {
    if (rounds.length <= NEIGHBOR * 2 + 1) return rounds;
    let center = rounds.findIndex((r) => r.id === activeId);
    if (center < 0) center = rounds.length - 1; // 未定位到底部时取最新
    const start = Math.max(0, Math.min(center - NEIGHBOR, rounds.length - (NEIGHBOR * 2 + 1)));
    return rounds.slice(start, start + NEIGHBOR * 2 + 1);
  }, [rounds, activeId]);

  const jump = (id: string) => {
    const el = containerRef.current;
    const node = el?.querySelector(`[data-mid="${id}"]`);
    if (node) (node as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    setOpen(false);
  };

  if (rounds.length === 0) return null;
  const PITCH = 20; // 每格垂直间距（紧凑且互不压字）

  return (
    <div className="round-nav" ref={rootRef}>
      {/* 刻度条与展开项一体：悬停时文字在刻度旁原位展开，严格一一对齐 */}
      <div
        className={`round-nav-rail ${open ? 'open' : ''}`}
        style={{ height: windowed.length * PITCH }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { setHoverId(null); setOpen(false); }}
        title={t('roundNav.title')}
      >
        {windowed.map((r, i) => (
          <span
            key={r.id}
            className={`round-tick ${r.id === activeId ? 'active' : ''} ${r.id === hoverId ? 'hover' : ''}`}
            onMouseEnter={() => setHoverId(r.id)}
            style={{ top: i * PITCH + PITCH / 2 }}
            onClick={(e) => {
              e.stopPropagation();
              jump(r.id);
            }}
          />
        ))}
        {open && (
          <div className="round-nav-labels" style={{ height: windowed.length * PITCH }}>
            {windowed.map((r, i) => (
              <div
                key={r.id}
                className={`round-nav-item ${r.id === activeId ? 'active' : ''} ${r.id === hoverId ? 'hover' : ''}`}
                style={{ top: i * PITCH + PITCH / 2 }}
                onMouseEnter={() => setHoverId(r.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  jump(r.id);
                }}
                title={r.title}
              >
                {r.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
