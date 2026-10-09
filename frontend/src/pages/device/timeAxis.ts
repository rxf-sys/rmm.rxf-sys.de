/** Time labels and axis ticks for the device charts. */

const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ts: number) => {
  const t = new Date(ts * 1000);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const dayTick = (ts: number) => {
  const t = new Date(ts * 1000);
  return `${WEEKDAY[t.getDay()]} ${pad(t.getDate())}.${pad(t.getMonth() + 1)}.`;
};

/** Ticks on round local hours, or on local midnight for a week. Walking the
 *  calendar instead of adding seconds keeps them right across DST. */
export function ticksFor(from: number, to: number, stepS: number): number[] {
  const out: number[] = [];
  const d = new Date(from * 1000);
  if (stepS >= 86400) {
    d.setHours(24, 0, 0, 0);
    for (; d.getTime() / 1000 <= to; d.setDate(d.getDate() + 1)) out.push(d.getTime() / 1000);
  } else {
    const every = stepS / 3600;
    d.setMinutes(60, 0, 0);
    for (; d.getTime() / 1000 <= to; d.setHours(d.getHours() + 1)) {
      if (d.getHours() % every === 0) out.push(d.getTime() / 1000);
    }
  }
  return out;
}
