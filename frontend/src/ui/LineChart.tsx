import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { segmentsOf } from '../fleetChart';

export interface ChartSeries {
  key: string;
  label: string;
  /** A series colour token (var(--s1)…); never a status colour. */
  color: string;
  dashed?: boolean;
  points: { ts: number; v: number }[];
}

interface Props {
  series: ChartSeries[];
  /** Window in epoch seconds; the x axis spans it even where data is missing. */
  from: number;
  to: number;
  /** Top of the y axis (the bottom is 0). */
  yMax: number;
  /** Distance between grid lines; `yMax` must be a multiple of it, so that
   *  every line carries a round value. Defaults to quarters. */
  yStep?: number;
  unit?: string;
  height?: number;
  /** Gaps longer than this are not bridged — no invented measurements. */
  gapS?: number;
  /** One sentence for screen readers: what the chart says. */
  summary: string;
  /** Label of a point in time (tooltip and axis). */
  formatTime: (ts: number) => string;
  /** Axis ticks in epoch seconds. */
  ticks: number[];
  formatTick?: (ts: number) => string;
}

const VB_W = 1000;

/**
 * Time-series line chart: one y axis, thin lines, a recessive grid, a legend
 * that always names every series with its current value (identity is never
 * colour alone), dashes for the third series, and a crosshair tooltip that
 * works with a mouse, a finger and the arrow keys.
 *
 * Axis labels are HTML, so they keep their size on a phone where an SVG
 * viewBox would shrink them to unreadable.
 */
export function LineChart({
  series,
  from,
  to,
  yMax,
  yStep = yMax / 4,
  unit = '\u00a0%',
  height = 180,
  gapS = 1.5 * 3600,
  summary,
  formatTime,
  ticks,
  formatTick = formatTime,
}: Props) {
  const tipId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const span = Math.max(1, to - from);
  const x = (ts: number) => ((ts - from) / span) * VB_W;
  const y = (v: number) => height - (Math.min(Math.max(v, 0), yMax) / (yMax || 1)) * height;
  const grid = yMax > 0 && yStep > 0 ? Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep) : [0];

  // All timestamps that exist in any series, for snapping the crosshair.
  const stamps = useMemo(
    () => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.ts)))).sort((a, b) => a - b),
    [series],
  );

  const nearest = (ts: number): number | null => {
    if (!stamps.length) return null;
    let best = stamps[0]!;
    for (const s of stamps) if (Math.abs(s - ts) < Math.abs(best - ts)) best = s;
    return best;
  };
  const valueAt = (s: ChartSeries, ts: number) => s.points.find((p) => p.ts === ts)?.v;

  const fromPointer = (e: PointerEvent) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setHoverTs(nearest(from + ratio * span));
  };

  const onKey = (e: KeyboardEvent) => {
    if (!stamps.length) return;
    const i = hoverTs === null ? stamps.length : stamps.indexOf(hoverTs);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.max(0, Math.min(stamps.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      setHoverTs(stamps[next] ?? null);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setHoverTs(e.key === 'Home' ? stamps[0]! : stamps[stamps.length - 1]!);
    } else if (e.key === 'Escape') {
      setHoverTs(null);
    }
  };

  const fmtV = (v: number) => `${Math.round(v)}${unit}`;
  // The legend reads the whole window, not only its last sample: "Ø" next to
  // the latest value would claim an average that it is not. Once per data
  // change — the crosshair re-renders on every pointer move.
  const stats = useMemo(
    () =>
      series.map((s) => {
        if (!s.points.length) return null;
        let sum = 0;
        let peak = -Infinity;
        for (const p of s.points) {
          sum += p.v;
          peak = Math.max(peak, p.v);
        }
        return { last: s.points[s.points.length - 1]!.v, mean: sum / s.points.length, peak };
      }),
    [series],
  );
  function valueText(ts: number | null): string {
    if (ts === null) return 'keine Daten';
    const parts = series.map((s) => {
      const v = valueAt(s, ts);
      return `${s.label} ${v === undefined ? 'keine Daten' : fmtV(v)}`;
    });
    return `${formatTime(ts)}: ${parts.join(', ')}`;
  }
  const hoverLeft = hoverTs === null ? 0 : (x(hoverTs) / VB_W) * 100;
  // The tip sits inside the plot beside the crosshair, on the side with more
  // room — above the plot it covered the panel's title.
  const tipFlip = hoverLeft > 50;

  return (
    <div className="lc">
      <div className="lc-frame" style={{ height }}>
        <div className="lc-y" aria-hidden>
          {grid.map((g) => (
            <span key={g} style={{ top: y(g) }}>
              {g}
              {unit}
            </span>
          ))}
        </div>
        {/* The crosshair is a slider over time: arrows, Home and End move it,
            and the value text reads out every series at that moment. */}
        <div
          ref={plotRef}
          className="lc-plot"
          tabIndex={0}
          role="slider"
          aria-label={summary}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, stamps.length - 1)}
          aria-valuenow={hoverTs === null ? stamps.length - 1 : stamps.indexOf(hoverTs)}
          aria-valuetext={valueText(hoverTs ?? stamps[stamps.length - 1] ?? null)}
          onPointerMove={fromPointer}
          onPointerDown={fromPointer}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHoverTs(null);
          }}
          onKeyDown={onKey}
          onBlur={() => setHoverTs(null)}
        >
          <svg viewBox={`0 0 ${VB_W} ${height}`} preserveAspectRatio="none" aria-hidden className="lc-svg">
            {grid.map((g) => (
              <line key={g} x1={0} x2={VB_W} y1={y(g)} y2={y(g)} className="lc-grid" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) =>
              segmentsOf(s.points, gapS).map((seg) =>
                seg.length > 1 ? (
                  <polyline
                    key={`${s.key}-${seg[0]!.ts}`}
                    points={seg.map((p) => `${x(p.ts).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? '6 5' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              ),
            )}
            {hoverTs !== null && (
              <line x1={x(hoverTs)} x2={x(hoverTs)} y1={0} y2={height} className="lc-cross" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {hoverTs !== null &&
            series.map((s) => {
              const v = valueAt(s, hoverTs);
              return v === undefined ? null : (
                <span
                  key={s.key}
                  className="lc-dot"
                  style={{ left: `${hoverLeft}%`, top: y(v), background: s.color }}
                  aria-hidden
                />
              );
            })}
          {hoverTs !== null && (
            <div
              id={tipId}
              className={tipFlip ? 'lc-tip flip' : 'lc-tip'}
              aria-hidden
              style={{ '--x': `${hoverLeft}%` } as CSSProperties}
            >
              <span className="lc-tip-when">{formatTime(hoverTs)}</span>
              {series.map((s) => {
                const v = valueAt(s, hoverTs);
                return (
                  <span key={s.key} className="lc-tip-row">
                    <i className={s.dashed ? 'lc-swatch dashed' : 'lc-swatch'} style={{ borderColor: s.color }} />
                    {s.label}
                    <b>{v === undefined ? '—' : fmtV(v)}</b>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="lc-x" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(x(t) / VB_W) * 100}%` }}>
            {formatTick(t)}
          </span>
        ))}
      </div>
      <ul className="lc-legend">
        {series.map((s, i) => {
          const st = stats[i];
          return (
            <li key={s.key}>
              <i className={s.dashed ? 'lc-swatch dashed' : 'lc-swatch'} style={{ borderColor: s.color }} aria-hidden />
              {s.label}
              {st ? (
                <>
                  <span className="lc-legend-k">zuletzt</span>
                  <b>{fmtV(st.last)}</b>
                  <span className="lc-legend-k">
                    · Ø {fmtV(st.mean)} · Spitze {fmtV(st.peak)}
                  </span>
                </>
              ) : (
                <b>—</b>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
