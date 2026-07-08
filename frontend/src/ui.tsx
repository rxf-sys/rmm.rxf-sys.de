/** Shared UI helpers: status → color/label mapping, small presentational
 * pieces reused across the Vektor screens. Keeps the color semantics from the
 * design in one place. */

import type { Device } from './types';

export type DeviceState = 'ok' | 'warn' | 'crit' | 'off';

/** Derive the coarse visual state of a device from live signals. */
export function deviceState(d: Device): DeviceState {
  if (!d.online) return 'off';
  const maxDisk = Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
  if (maxDisk >= 90) return 'crit';
  if (maxDisk >= 80) return 'warn';
  return 'ok';
}

/** CSS color var for a device state dot. */
export function stateColor(s: DeviceState): string {
  return s === 'off'
    ? 'var(--tx3)'
    : s === 'crit'
      ? 'var(--dangerS)'
      : s === 'warn'
        ? 'var(--warn)'
        : 'var(--ok)';
}

export function diskColor(pct: number): string {
  return pct >= 90 ? 'var(--dangerS)' : pct >= 80 ? 'var(--warn)' : 'var(--tx2)';
}

const OS_SHORT: Record<string, string> = { windows: 'WIN', linux: 'LNX', darwin: 'MAC' };
export function osShort(os: string): string {
  return OS_SHORT[os] ?? os.slice(0, 3).toUpperCase();
}

/** A glowing status dot. */
export function Dot({ color, lg }: { color: string; lg?: boolean }) {
  return (
    <span
      className={lg ? 'dot dot-lg' : 'dot'}
      style={{ background: color, boxShadow: `0 0 ${lg ? 9 : 8}px ${color}` }}
    />
  );
}

/** Pulsing skeleton block. */
export function Skeleton({ h = 88, style }: { h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, ...style }} />;
}
