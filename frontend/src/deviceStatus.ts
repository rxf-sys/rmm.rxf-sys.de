/** Status → colour/label mapping shared across the screens.
 *
 * Kept apart from ui.tsx so that file exports components only: mixing
 * component and non-component exports breaks React Fast Refresh, which is
 * what react-refresh/only-export-components warns about. */

import type { Alert, Device } from './types';

export type DeviceState = 'ok' | 'warn' | 'crit' | 'off';

/** Derive the coarse visual state of a device from live signals. */
export function deviceState(d: Device): DeviceState {
  if (!d.online) return 'off';
  const maxDisk = Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
  if (maxDisk >= 90) return 'crit';
  if (maxDisk >= 80) return 'warn';
  return 'ok';
}

/**
 * Is something wrong on a device we can actually reach?
 *
 * Deliberately not "state !== 'ok'": that counted every offline device as a
 * problem, so the same machine appeared under both "Probleme" and "Offline"
 * and the filter counts added up to more than the fleet. Offline is its own
 * condition with its own filter.
 *
 * A device that went offline with a full disk therefore counts as offline
 * only — which is the honest answer, because nothing about that disk can be
 * done until the machine is reachable again.
 */
export function hasProblem(d: Device): boolean {
  const s = deviceState(d);
  return s === 'warn' || s === 'crit';
}

/** The three load metrics shown as bars. */
export type LoadKind = 'cpu' | 'ram' | 'disk';

/**
 * Where a metric turns yellow and where it turns red.
 *
 * The disk row deliberately matches `deviceState()` above: if the bar and the
 * status dot disagreed about the same device, one of them would be lying.
 * CPU tolerates more than RAM — a box pinned at 80 % CPU is working, a box at
 * 90 % RAM is about to start swapping.
 */
export const LOAD_THRESHOLDS: Record<LoadKind, { warn: number; crit: number }> = {
  cpu: { warn: 70, crit: 90 },
  ram: { warn: 75, crit: 90 },
  disk: { warn: 80, crit: 90 },
};

export function loadLevel(pct: number, kind: LoadKind): 'ok' | 'warn' | 'crit' {
  const t = LOAD_THRESHOLDS[kind];
  if (pct >= t.crit) return 'crit';
  if (pct >= t.warn) return 'warn';
  return 'ok';
}

const OS_SHORT: Record<string, string> = {
  windows: 'WIN',
  linux: 'LNX',
  darwin: 'MAC',
  ios: 'iOS',
  ipados: 'iPad',
  android: 'AND',
  other: 'GER',
};
export function osShort(os: string): string {
  return OS_SHORT[os] ?? os.slice(0, 3).toUpperCase();
}

/** Status kind for StatusBadge: devices without an agent have no live state. */
export function deviceStatusKind(d: Device): 'ok' | 'warn' | 'danger' | 'off' | 'noagent' {
  if (d.device_class === 'mobile') return 'noagent';
  const s = deviceState(d);
  return s === 'off' ? 'off' : s === 'crit' ? 'danger' : s === 'warn' ? 'warn' : 'ok';
}

const STATUS_WORD = { ok: 'OK', warn: 'Warnung', danger: 'Kritisch', off: 'Offline', noagent: 'Ohne Agent' } as const;

/** The word for a device's status, as shown next to its icon. */
export function deviceStatusLabel(d: Device): string {
  return STATUS_WORD[deviceStatusKind(d)];
}

/** Severity of an alert as the device's current state tells it: a disk
 *  alert on a device that is critical right now is critical. */
export function alertStatusKind(a: Alert, device: Device | undefined): 'off' | 'danger' | 'warn' {
  if (a.rule === 'offline') return 'off';
  if (a.rule === 'disk' && device && deviceStatusKind(device) === 'danger') return 'danger';
  return 'warn';
}
