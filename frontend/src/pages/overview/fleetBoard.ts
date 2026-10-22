/**
 * The Lagebild as data: what one device tile says, in which order the tiles
 * stand and what the state filter counts. Kept apart from the component so
 * each rule has one definition the tests can hold on to.
 */
import { isAgent } from '../../deviceClass';
import { deviceStatusKind, loadLevel, type LoadKind } from '../../deviceStatus';
import type { Alert, Device, PatchSummary } from '../../types';

export type TileKind = 'danger' | 'warn' | 'off' | 'ok' | 'noagent';
export type BoardFilter = 'alle' | TileKind;

/** Problems first: what needs a look stands top left. */
export const KIND_ORDER: TileKind[] = ['danger', 'warn', 'off', 'ok', 'noagent'];

export const KIND_LABEL: Record<TileKind, string> = {
  danger: 'Kritisch',
  warn: 'Warnung',
  off: 'Offline',
  ok: 'OK',
  noagent: 'Ohne Agent',
};

/** Tiles shown before "Alle anzeigen": two to four rows on a laptop. */
export const TILE_LIMIT = 24;

export interface LoadReading {
  kind: LoadKind;
  label: string;
  /** Whole percent. */
  pct: number;
  level: 'ok' | 'warn' | 'crit';
  /** For the fullest disk: which mount it is. */
  detail?: string;
}

export interface Tile {
  device: Device;
  kind: TileKind;
  /** CPU, RAM and the fullest disk — only for a device that reports now. */
  load: LoadReading[];
  pending: number;
  security: number;
  neverScanned: boolean;
  openAlerts: number;
  rebootRequired: boolean;
  inMaintenance: boolean;
}

function reading(kind: LoadKind, label: string, value: number | undefined, detail?: string): LoadReading | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return { kind, label, pct, level: loadLevel(pct, kind), detail };
}

export function tileOf(d: Device, ps: PatchSummary, alerts: Alert[]): Tile {
  const kind = deviceStatusKind(d);
  const hb = d.heartbeat;
  const fullest = [...(hb.disks ?? [])].sort((a, b) => b.used_pct - a.used_pct)[0];
  const load =
    isAgent(d) && d.online
      ? [
          reading('cpu', 'CPU', hb.cpu_pct),
          reading('ram', 'RAM', hb.mem_pct),
          fullest ? reading('disk', 'Platte', fullest.used_pct, fullest.mount) : null,
        ].filter((r): r is LoadReading => r !== null)
      : [];
  const summary = ps[String(d.id)];
  return {
    device: d,
    kind,
    load,
    pending: summary?.pending ?? 0,
    security: summary?.security ?? 0,
    neverScanned: isAgent(d) && d.last_patch_scan_at <= 0,
    openAlerts: alerts.filter((a) => a.device_id === d.id && a.resolved_at === null).length,
    rebootRequired: isAgent(d) && hb.reboot_required === true,
    inMaintenance: d.maintenance_until !== null,
  };
}

/** Order inside one state: the most open security updates, then the most
 *  open updates, then by name — so the worst machine of a group leads it. */
function compare(a: Tile, b: Tile): number {
  return (
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    b.openAlerts - a.openAlerts ||
    b.security - a.security ||
    b.pending - a.pending ||
    a.device.hostname.localeCompare(b.device.hostname, 'de')
  );
}

export function buildTiles(devices: Device[], ps: PatchSummary, alerts: Alert[]): Tile[] {
  return devices.map((d) => tileOf(d, ps, alerts)).sort(compare);
}

export function countByKind(tiles: Tile[]): Record<TileKind, number> {
  const c: Record<TileKind, number> = { danger: 0, warn: 0, off: 0, ok: 0, noagent: 0 };
  for (const t of tiles) c[t.kind] += 1;
  return c;
}

export function filterTiles(tiles: Tile[], filter: BoardFilter, personId: number | null): Tile[] {
  return tiles.filter(
    (t) => (filter === 'alle' || t.kind === filter) && (personId === null || t.device.person_id === personId),
  );
}
