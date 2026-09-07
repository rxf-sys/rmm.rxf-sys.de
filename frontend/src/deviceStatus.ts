/** Status → colour/label mapping shared across the screens.
 *
 * Kept apart from ui.tsx so that file exports components only: mixing
 * component and non-component exports breaks React Fast Refresh, which is
 * what react-refresh/only-export-components warns about. */

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
