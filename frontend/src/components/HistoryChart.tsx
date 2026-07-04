import { useMemo, useRef, useState } from 'react';
import type { MetricSample } from '../types';

/** Series colors: validated categorical slots (dark mode, surface #171c26)
 * via the palette validator — lightness band, chroma, CVD separation and
 * contrast all pass. Identity is never color-alone: legend + tooltip name
 * every series. */
const SERIES = [
  { key: 'cpu_pct', label: 'CPU', color: '#3987e5' },
  { key: 'mem_pct', label: 'RAM', color: '#199e70' },
  { key: 'disk_max_pct', label: 'Disk (max)', color: '#c98500' },
] as const;

const W = 720;
const H = 220;
const PAD = { top: 12, right: 14, bottom: 24, left: 38 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

interface Props {
  samples: MetricSample[];
}

function timeLabel(ts: number, rangeS: number): string {
  const d = new Date(ts * 1000);
  if (rangeS > 48 * 3600) {
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function HistoryChart({ samples }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { t0, t1 } = useMemo(() => {
    if (samples.length === 0) return { t0: 0, t1: 1 };
    return { t0: samples[0].ts, t1: Math.max(samples[samples.length - 1].ts, samples[0].ts + 1) };
  }, [samples]);

  if (samples.length < 2) {
    return <p className="panel-muted">Noch nicht genug Verlaufsdaten — der Chart füllt sich mit jedem Heartbeat.</p>;
  }

  const x = (ts: number) => PAD.left + ((ts - t0) / (t1 - t0)) * PLOT_W;
  const y = (pct: number) => PAD.top + (1 - Math.min(100, Math.max(0, pct)) / 100) * PLOT_H;

  const lines = SERIES.map((s) => ({
    ...s,
    points: samples.map((p) => `${x(p.ts).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' '),
  }));

  // 4 x-ticks across the range; y-grid at fixed 0/25/50/75/100.
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * (t1 - t0));
  const yTicks = [0, 25, 50, 75, 100];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ts = t0 + (((e.clientX - rect.left) / rect.width) * W - PAD.left) / PLOT_W * (t1 - t0);
    // Nearest sample (samples are time-ordered).
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dist = Math.abs(samples[i].ts - ts);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hover = hoverIdx !== null ? samples[hoverIdx] : null;

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        {SERIES.map((s) => (
          <span key={s.key} className="legend-item">
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="history-chart"
          role="img"
          aria-label="Verlauf von CPU-, RAM- und Disk-Auslastung in Prozent"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="chart-grid"
              />
              <text x={PAD.left - 6} y={y(t) + 3.5} className="chart-tick" textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {xTicks.map((ts, i) => (
            <text
              key={i}
              x={x(ts)}
              y={H - 6}
              className="chart-tick"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {timeLabel(ts, t1 - t0)}
            </text>
          ))}
          {lines.map((l) => (
            <polyline
              key={l.key}
              points={l.points}
              fill="none"
              stroke={l.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover && (
            <g>
              <line
                x1={x(hover.ts)}
                x2={x(hover.ts)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                className="chart-crosshair"
              />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover.ts)}
                  cy={y(hover[s.key])}
                  r={4}
                  fill={s.color}
                  className="chart-hover-dot"
                />
              ))}
            </g>
          )}
        </svg>
        {hover && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(x(hover.ts) / W) * 100}%`,
              transform: x(hover.ts) > W * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <div className="tooltip-time">{new Date(hover.ts * 1000).toLocaleString('de-DE')}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="tooltip-row">
                <span className="legend-swatch" style={{ background: s.color }} />
                {s.label}: {hover[s.key].toFixed(0)}%
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
