// 设置页 - 用量 tab：总览卡片（等高等宽）+ 近 7 天趋势图 + 三维度 donut 占比图（纯 CSS/SVG）
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { heatLevel, type UsageSummary } from '../../../electron/shared';
import { PageHeader } from './kit';

// 千分位 + 缩写
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString();
}

// 主题语义色板（按序分配）
const PALETTE = ['#525252', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#9ca3af'];

interface Row {
  name: string;
  input: number;
  output: number;
}

// ---- 单维度 donut + 图例 ----
function Donut({ title, rows }: { title: string; rows: Row[] }) {
  const { t } = useTranslation();
  const total = rows.reduce((acc, r) => acc + r.input + r.output, 0);
  if (total === 0) {
    return (
      <div className="donut-block">
        <div className="usage-section-title">{title}</div>
        <div className="hint">{t('usage.empty')}</div>
      </div>
    );
  }
  const R = 34;
  const C = 2 * Math.PI * R;
  // 段间间隙：多段时每段减去 GAP 形成视觉分隔，避免颜色收尾相连分不清
  const GAP = rows.length > 1 ? 3 : 0;
  let offset = 0;
  // 不再截断，显示全部条目；颜色按调色板循环
  const segs = rows.map((r, i) => {
    const value = r.input + r.output;
    const frac = value / total;
    const dash = Math.max(0, frac * C - GAP);
    const seg = { name: r.name, value, color: PALETTE[i % PALETTE.length], dash, offset: offset * C };
    offset += frac;
    return seg;
  });

  return (
    <div className="donut-block">
      <div className="usage-section-title">{title}</div>
      <div className="donut-wrap">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r={R} fill="none" stroke="var(--bg-hover)" strokeWidth="12" />
          {segs.map((s, i) => (
            <circle
              key={i}
              cx="48"
              cy="48"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.offset}
              strokeLinecap="butt"
              transform="rotate(-90 48 48)"
            />
          ))}
          <text x="48" y="52" textAnchor="middle" className="donut-center">
            {fmt(total)}
          </text>
        </svg>
        <div className="donut-legend">
          {segs.map((s, i) => (
            <div key={i} className="donut-legend-row">
              <span className="donut-dot" style={{ background: s.color }} />
              <span className="donut-name" title={s.name}>{s.name}</span>
              <span className="donut-value">{fmt(s.value)}</span>
              <span className="donut-pct">{Math.round((s.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- GitHub contributions 风格热力图（列=周，行=周一~周日） ----
function Heatmap({ series }: { series: UsageSummary['dailySeries'] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<{ day: string; input: number; output: number; x: number; y: number } | null>(null);

  // 按 7 天一周切列
  const weeks: Array<typeof series> = [];
  for (let i = 0; i < series.length; i += 7) weeks.push(series.slice(i, i + 7));

  const max = Math.max(1, ...series.map((d) => d.input + d.output));

  return (
    <div className="heatmap-root">
      <div className="heatmap">
        {weeks.map((week, wi) => (
          <div key={wi} className="heatmap-week">
            {week.map((d) => {
              const level = heatLevel(d.input + d.output, max);
              return (
                <div
                  key={d.day}
                  className={`heatmap-cell lv${level}`}
                  onMouseEnter={(e) => {
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setHover({ day: d.day, input: d.input, output: d.output, x: rect.left, y: rect.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {hover && (
        <div className="heatmap-tip" style={{ left: hover.x, top: hover.y - 46 }}>
          {hover.day}
          <br />↑ {fmt(hover.input)} ↓ {fmt(hover.output)}
        </div>
      )}
      <div className="heatmap-legend">
        <span>{t('usage.less')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heatmap-cell lv${l}`} />
        ))}
        <span>{t('usage.more')}</span>
      </div>
    </div>
  );
}

export default function UsageTab() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [weeks, setWeeks] = useState(16);
  const [sinceDays, setSinceDays] = useState<number | undefined>(undefined);
  const pageRef = useRef<HTMLDivElement>(null);

  // 按容器宽度动态计算周数：小方块 11px + 3px 间距 = 14px/列，铺满页面宽度
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth - 32; // 扣页面内边距
      setWeeks(Math.max(8, Math.min(53, Math.floor((w + 3) / 14))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    void window.hub.getUsageSummary(weeks, sinceDays).then(setSummary);
  }, [weeks, sinceDays]);

  if (!summary) return <div className="hint">…</div>;

  const isEmpty = summary.totalInput + summary.totalOutput === 0;
  const toRows = (list: Array<Record<string, unknown>>): Row[] =>
    list.map((r) => ({
      name: String(r.cli ?? r.model ?? r.cwd ?? ''),
      input: Number(r.input),
      output: Number(r.output),
    }));

  const RANGE_OPTIONS: Array<{ days: number | undefined; key: string }> = [
    { days: 1, key: 'usage.rangeToday' },
    { days: 7, key: 'usage.range7d' },
    { days: 30, key: 'usage.range30d' },
    { days: undefined, key: 'usage.rangeAll' },
  ];

  return (
    <div className="usage-page" ref={pageRef}>
      <PageHeader
        title={t('settings.tab.usage')}
        desc={summary.hasEstimated ? t('usage.estimatedNote') : undefined}
      />
      {/* 时间筛选 */}
      <div className="usage-range">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.key}
            className={`usage-range-btn ${sinceDays === o.days ? 'active' : ''}`}
            onClick={() => setSinceDays(o.days)}
          >
            {t(o.key)}
          </button>
        ))}
      </div>

      {isEmpty ? (
        <div className="usage-empty">
          <div className="usage-empty-icon">📊</div>
          <div>{t('usage.emptyState')}</div>
        </div>
      ) : (
        <>
          {/* 总览卡片：等高等宽 */}
          <div className="usage-cards">
            {(
              [
                [t('usage.total'), summary.totalInput + summary.totalOutput],
                [t('usage.today'), summary.todayInput + summary.todayOutput],
                [t('usage.week'), summary.weekInput + summary.weekOutput],
                [t('usage.inputOutput'), `${fmt(summary.totalInput)} / ${fmt(summary.totalOutput)}`],
              ] as const
            ).map(([label, value], i) => (
              <div key={i} className="usage-card">
                <div className="usage-card-value">{typeof value === 'number' ? fmt(value) : value}</div>
                <div className="usage-card-label">{label}</div>
              </div>
            ))}
          </div>

          <div className="usage-section-title">{t('usage.heatmapTitle')}</div>
          <Heatmap series={summary.dailySeries} />

          <div className="donut-grid">
            <Donut title={t('usage.byCli')} rows={toRows(summary.byCli)} />
            <Donut title={t('usage.byModel')} rows={toRows(summary.byModel)} />
            <Donut title={t('usage.byProject')} rows={toRows(summary.byProject)} />
          </div>
        </>
      )}
    </div>
  );
}
