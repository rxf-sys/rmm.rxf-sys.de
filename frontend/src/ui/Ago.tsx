import { formatAgo, formatDateTime } from '../format';

/** A moment as "vor 3 h", with the exact date and time as its tooltip;
 *  "nie" when there is none. `now` comes from useNow(), so it ticks. */
export function Ago({ ts, now }: { ts: number | null | undefined; now: number }) {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
}
