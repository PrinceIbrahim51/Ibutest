import type { RunCounts, RunStatus } from '@ibutest/shared';
import { type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { RUN_STATUS_META } from './ui';

/** Display order for status stacks: outcomes first, then pending work. */
export const STATUS_ORDER: RunStatus[] = ['passed', 'failed', 'blocked', 'in_progress', 'skipped', 'not_run'];

export function StatusLegend({ statuses = STATUS_ORDER }: { statuses?: RunStatus[] }) {
  return (
    <div className="legend" aria-label="Legend">
      {statuses.map((s) => {
        const Icon = RUN_STATUS_META[s].icon;
        return (
          <span key={s} className="legend-item">
            <span className={`legend-swatch bg-${s}`} aria-hidden />
            <Icon size={12} className={`st-${s}`} aria-hidden />
            {RUN_STATUS_META[s].text}
          </span>
        );
      })}
    </div>
  );
}

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const showAt = (clientX: number, clientY: number, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, content });
  };
  const fromPointer = (e: ReactPointerEvent, content: ReactNode) => showAt(e.clientX, e.clientY, content);
  const fromElement = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    showAt(r.left + r.width / 2, r.top, content);
  };
  const node = tip ? (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  ) : null;
  return { ref, fromPointer, fromElement, hide: () => setTip(null), node };
}

function TipRow({ status, value }: { status: RunStatus; value: number }) {
  return (
    <div className="tt-row">
      <span className={`tt-key bg-${status}`} aria-hidden />
      <span className="tt-value">{value}</span>
      <span className="text-2">{RUN_STATUS_META[status].text}</span>
    </div>
  );
}

/** Horizontal stacked bar of run outcomes (status job: fixed status colours + icon/label legend). */
export function StatusStackBar({ counts, large }: { counts: RunCounts | null; large?: boolean }) {
  const tip = useTooltip();
  const total = counts?.total ?? 0;
  if (!counts || total === 0) return <div className={`stackbar${large ? ' lg' : ''}`}><span className="seg bg-not_run" style={{ width: '100%' }} /></div>;
  const segments = STATUS_ORDER.filter((s) => counts[s] > 0);
  return (
    <div className="chart" ref={tip.ref} onPointerLeave={tip.hide}>
      <div className={`stackbar${large ? ' lg' : ''}`} role="img" aria-label={segments.map((s) => `${RUN_STATUS_META[s].text} ${counts[s]}`).join(', ')}>
        {segments.map((s) => {
          const content = (
            <>
              <TipRow status={s} value={counts[s]} />
              <div className="small muted">{Math.round((counts[s] / total) * 100)}% of {total}</div>
            </>
          );
          return (
            <button
              key={s}
              type="button"
              className={`seg bg-${s}`}
              style={{ width: `${(counts[s] / total) * 100}%` }}
              aria-label={`${RUN_STATUS_META[s].text}: ${counts[s]}`}
              onPointerMove={(e) => tip.fromPointer(e, content)}
              onFocus={(e) => tip.fromElement(e.currentTarget, content)}
              onBlur={tip.hide}
            />
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}

/** Tracks an element's width so SVG charts render at real pixel size (text never scales). */
function useWidth(ref: RefObject<HTMLElement | null>, fallback = 640): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= value) return m * pow;
  return 10 * pow;
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

/** Stacked daily executions for the last N days, with hover/focus tooltip and a table view. */
export function ExecutionTrend({ rows, days = 14 }: { rows: { day: string; status: RunStatus; n: number }[]; days?: number }) {
  const tip = useTooltip();
  const [showTable, setShowTable] = useState(false);
  const series: RunStatus[] = ['passed', 'failed', 'blocked', 'skipped', 'in_progress'];
  const data = useMemo(() => {
    const out: { day: string; counts: Record<RunStatus, number>; total: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0, in_progress: 0, not_run: 0 } as Record<RunStatus, number>;
      for (const r of rows) if (r.day === key) counts[r.status] += r.n;
      out.push({ day: key, counts, total: series.reduce((s, k) => s + counts[k], 0) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, days]);

  const W = useWidth(tip.ref);
  const H = 220;
  const pad = { l: 32, r: 8, t: 8, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.total)));
  const band = plotW / data.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const hasData = data.some((d) => d.total > 0);

  return (
    <div className="stack tight">
      <div className="chart" ref={tip.ref} onPointerLeave={tip.hide}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Test executions per day over the last ${days} days`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'baseline' : 'gridline'} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.l - 6} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.l + band * i + band / 2;
            let acc = 0;
            const present = series.filter((s) => d.counts[s] > 0);
            const content = (
              <>
                <div className="small muted">{new Date(`${d.day}T00:00:00`).toLocaleDateString()}</div>
                {series.map((s) => (
                  <TipRow key={s} status={s} value={d.counts[s]} />
                ))}
              </>
            );
            return (
              <g key={d.day}>
                {present.map((s, j) => {
                  const h = (d.counts[s] / max) * plotH;
                  const top = y(acc + d.counts[s]);
                  acc += d.counts[s];
                  const isTop = j === present.length - 1;
                  // 2px surface gap between stacked segments.
                  const segH = Math.max(1, h - (isTop ? 0 : 2));
                  const x0 = cx - barW / 2;
                  const r = Math.min(4, segH, barW / 2);
                  const path = isTop
                    ? `M${x0},${top + segH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + segH} Z`
                    : `M${x0},${top + segH + (isTop ? 0 : 2)} V${top + 2} H${x0 + barW} V${top + segH + 2} Z`;
                  return <path key={s} className={`fill-${s}`} d={path} />;
                })}
                {((data.length - 1 - i) % (band < 36 ? 2 : 1) === 0) && (
                  <text className="tick" x={cx} y={H - 6} textAnchor="middle">
                    {Number(d.day.slice(8))}
                  </text>
                )}
                <rect
                  className="hit"
                  x={pad.l + band * i}
                  y={pad.t}
                  width={band}
                  height={plotH}
                  tabIndex={0}
                  aria-label={`${d.day}: ${d.total} executions`}
                  onPointerMove={(e) => tip.fromPointer(e, content)}
                  onFocus={(e) => tip.fromElement(e.currentTarget, content)}
                  onBlur={tip.hide}
                />
              </g>
            );
          })}
        </svg>
        {tip.node}
        {!hasData && <div className="empty small">No executions in this period</div>}
      </div>
      <div className="row between wrap">
        <StatusLegend statuses={series} />
        <button type="button" className="btn ghost sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? 'Hide table' : 'Show table'}
        </button>
      </div>
      {showTable && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                {series.map((s) => (
                  <th key={s} className="num">
                    {RUN_STATUS_META[s].text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  {series.map((s) => (
                    <td key={s} className="num">
                      {d.counts[s]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Single-series horizontal bars (magnitude), value at the bar tip. */
export function HBarList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stack tight" role="list">
      {items.map((i) => (
        <div key={i.label} className="hbar-row" role="listitem">
          <span className="text-2">{i.label}</span>
          <div className="hbar-track">
            {i.value > 0 && <div className="hbar" style={{ width: `${(i.value / max) * 100}%` }} />}
          </div>
          <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {i.value}
          </span>
        </div>
      ))}
    </div>
  );
}
