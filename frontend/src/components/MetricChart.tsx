import { useRef, useState } from 'react';
import { segmentsOf } from '../fleetChart';
import type { MetricSample } from '../types';

/** Die drei Reihen des Verlaufs. Farben sind hier Serienfarben und keine
 *  Lastfarben: drei Linien müssen unterscheidbar sein, und eine Linie, die
 *  unterwegs die Farbe wechselt, ließe sich nicht mehr verfolgen. */
const SERIES = [
  { key: 'cpu_pct', label: 'CPU', color: 'var(--accent)', dash: '' },
  { key: 'mem_pct', label: 'RAM', color: 'var(--violet)', dash: '' },
  { key: 'disk_max_pct', label: 'Disk max', color: 'var(--warn)', dash: '4 3' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

const W = 720;
const H = 210;
const PAD_L = 34;
const PAD_B = 20;
const PAD_T = 10;

function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Über mehr als einen Tag sagt eine Uhrzeit allein nichts mehr. */
function tickLabel(ts: number, hours: number): string {
  if (hours <= 24) return clock(ts);
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${d.getDate()}.`;
}

interface Props {
  samples: MetricSample[];
  /** Breite des Fensters in Stunden — legt die x-Achse fest, damit drei
   *  Messpunkte nicht über einen ganzen Tag gestreckt werden. */
  hours: number;
  /** Sekunden seit Epoch; von außen gereicht, damit die Komponente rein bleibt. */
  now: number;
}

/**
 * Verlauf von CPU, RAM und Plattenbelegung eines Geräts.
 *
 * Vorher: drei Linien ohne beschriftete Achse, ohne Werte beim Überfahren,
 * mit `preserveAspectRatio="none"` (was die Linienstärke verzerrte) und einer
 * x-Achse, die sich über die vorhandenen Messpunkte spannte statt über das
 * gewählte Zeitfenster — bei einem Gerät, das seit zehn Minuten meldet, sah
 * das aus wie ein Tagesverlauf.
 */
export function MetricChart({ samples, hours, now }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  if (samples.length < 2) {
    return (
      <p className="muted" style={{ margin: '20px 0', fontSize: 12 }}>
        Noch nicht genug Verlaufsdaten — der Chart füllt sich mit jedem Heartbeat.
      </p>
    );
  }

  const from = now - hours * 3600;
  const x = (ts: number) => PAD_L + ((ts - from) / (now - from)) * (W - PAD_L);
  const y = (v: number) => H - PAD_B - (v / 100) * (H - PAD_B - PAD_T);
  // Rohwerte kommen im Heartbeat-Takt; eine Lücke von mehr als zehn Minuten
  // heißt, das Gerät war weg — und wird nicht überzeichnet.
  const segments = segmentsOf(samples, 600);
  const active = hover === null ? null : samples[hover];

  const points = (rows: MetricSample[], key: SeriesKey) =>
    rows.map((s) => `${x(s.ts).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => from + f * (now - from));

  const pick = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const ts = from + ((ratio * W - PAD_L) / (W - PAD_L)) * (now - from);
    let best = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if (Math.abs(samples[i]!.ts - ts) < Math.abs(samples[best]!.ts - ts)) best = i;
    }
    setHover(best);
  };

  return (
    <div className="metric-chart" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`Verlauf von CPU, RAM und Plattenbelegung über ${hours} Stunden`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line2)" strokeWidth="1" />
            <text className="ov-tick" x={PAD_L - 6} y={y(v) + 3} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}

        {segments.map((seg) =>
          SERIES.map((s) =>
            seg.length > 1 ? (
              <polyline
                key={`${seg[0]!.ts}-${s.key}`}
                points={points(seg, s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dash ? 1.5 : 2}
                strokeDasharray={s.dash || undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle
                key={`${seg[0]!.ts}-${s.key}`}
                cx={x(seg[0]!.ts)}
                cy={y(seg[0]![s.key])}
                r="1.8"
                fill={s.color}
              />
            ),
          ),
        )}

        {active && (
          <>
            <line
              x1={x(active.ts)}
              x2={x(active.ts)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--accLine)"
              strokeWidth="1"
            />
            {SERIES.map((s) => (
              <circle key={s.key} cx={x(active.ts)} cy={y(active[s.key])} r="3" fill={s.color} />
            ))}
          </>
        )}

        {ticks.map((t) => (
          <text key={t} className="ov-tick" x={x(t)} y={H - 4} textAnchor="middle">
            {tickLabel(t, hours)}
          </text>
        ))}
      </svg>

      {active && (
        <div className="metric-tip" style={{ left: `${(x(active.ts) / W) * 100}%` }}>
          <span className="metric-tip-when">{clock(active.ts)}</span>
          {SERIES.map((s) => (
            <span key={s.key} className="metric-tip-row">
              <span className="metric-sw" style={{ background: s.color }} />
              {s.label}
              <b>{Math.round(active[s.key])} %</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
