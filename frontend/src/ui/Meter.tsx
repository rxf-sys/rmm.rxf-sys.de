import type { ReactNode } from 'react';

export type MeterLevel = 'ok' | 'warn' | 'crit' | 'none';

interface Props {
  label: ReactNode;
  /** 0–100, or null when the device does not report it. */
  value: number | null | undefined;
  level: MeterLevel;
  /** Absolute figures next to the percentage, e.g. "5,0 / 16 GB". */
  detail?: ReactNode;
  /** Threshold marks in percent (warning, critical). */
  marks?: number[];
  title?: string;
}

/** A labelled usage bar. Colour only once a threshold is crossed; the
 *  number is always printed. */
export function Meter({ label, value, level, detail, marks = [], title }: Props) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const pct = has ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className={`meter2 lvl-${has ? level : 'none'}`}>
      <div className="meter2-head">
        <span className="meter2-label" title={title}>
          {label}
        </span>
        <span className="meter2-value">
          {detail && <span className="meter2-detail">{detail}</span>}
          <b>{has ? `${Math.round(pct)} %` : '—'}</b>
        </span>
      </div>
      {/* Without a value the track is decoration: a meter needs
          aria-valuenow, and the "—" in the head already says it. */}
      <div
        className="meter2-track"
        {...(has
          ? {
              role: 'meter',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': Math.round(pct),
              'aria-label': typeof label === 'string' ? label : undefined,
            }
          : { 'aria-hidden': true })}
      >
        <span style={{ width: `${pct}%` }} />
        {marks.map((m) => (
          <i key={m} style={{ left: `${m}%` }} />
        ))}
      </div>
    </div>
  );
}
