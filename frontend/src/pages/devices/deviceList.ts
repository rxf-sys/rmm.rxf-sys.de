/**
 * The device list as data: which devices a filter keeps, how a column sorts,
 * and what an export contains. Kept apart from the page so each rule has one
 * definition the tests can hold on to.
 */
import { isAgent } from '../../deviceClass';
import { deviceStatusKind, deviceStatusLabel, hasProblem } from '../../deviceStatus';
import { osLabel } from '../../format';
import { compareVersions } from '../../version';
import type { Device, PatchSummary } from '../../types';
import { toCsvDocument, type CsvValue } from '../../csv';

// ---- Filters ----------------------------------------------------------------

export type Filter = 'alle' | 'ok' | 'probleme' | 'server' | 'familie' | 'offline' | 'mobil';

export const FILTERS: Filter[] = ['alle', 'ok', 'probleme', 'offline', 'server', 'familie', 'mobil'];

export const FILTER_LABEL: Record<Filter, string> = {
  alle: 'Alle',
  ok: 'In Ordnung',
  probleme: 'Probleme',
  server: 'Server',
  familie: 'Familie',
  offline: 'Offline',
  mobil: 'Ohne Agent',
};

export function isFilter(v: string | null): v is Filter {
  return FILTERS.includes(v as Filter);
}

/** Does a device belong in this filter? One predicate per filter, so the
 *  counts on the chips and the rows below can never drift apart.
 *
 *  Die Zustandsfilter fragen zusätzlich nach der Geräteklasse: ein Telefon
 *  meldet weder Erreichbarkeit noch Auslastung, stünde also dauerhaft unter
 *  „Offline". Tags gelten dagegen für jedes Gerät. */
export function matchesFilter(d: Device, f: Filter): boolean {
  switch (f) {
    case 'mobil':
      return !isAgent(d);
    case 'ok':
      // Erreichbar und ohne Befund — das Gegenstück zu 'probleme', damit das
      // Lagebild der Übersicht auf jede seiner Gruppen verlinken kann.
      return isAgent(d) && d.online && !hasProblem(d);
    case 'server':
      return d.tags.includes('server');
    case 'familie':
      return d.tags.includes('familie');
    case 'probleme':
      // Nur erreichbare Geräte mit einem echten Befund. Offline hat seinen
      // eigenen Filter — siehe hasProblem().
      return isAgent(d) && hasProblem(d);
    case 'offline':
      return isAgent(d) && !d.online;
    default:
      return true;
  }
}

// ---- Measurements -----------------------------------------------------------

/** Fullest disk in percent; null when the device reports none. Disk usage
 *  survives a reboot, so it stays meaningful while the device is offline. */
export function diskPct(d: Device): number | null {
  if (!isAgent(d)) return null;
  const disks = d.heartbeat.disks ?? [];
  if (disks.length === 0) return null;
  return Math.max(...disks.map((x) => x.used_pct));
}

/** CPU or RAM in percent, but only from a device that is online right now —
 *  the last value of an offline machine is history, not load. */
export function livePct(d: Device, key: 'cpu_pct' | 'mem_pct'): number | null {
  if (!isAgent(d) || !d.online) return null;
  const v = d.heartbeat[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** When someone last heard from the device: the agent's heartbeat, or for a
 *  device without agent the last time someone checked it by hand. */
export function lastSeen(d: Device): number | null {
  return isAgent(d) ? d.last_seen_at : d.checked_at;
}

// ---- Sorting ----------------------------------------------------------------

export type SortKey = 'name' | 'status' | 'person' | 'cpu' | 'ram' | 'disk' | 'updates' | 'agent' | 'seen';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

const SORT_KEYS: SortKey[] = ['name', 'status', 'person', 'cpu', 'ram', 'disk', 'updates', 'agent', 'seen'];

/** The direction a column sorts in on its first click: the one that answers
 *  the question the column is for — worst first, fullest first, newest first. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  status: 'desc',
  person: 'asc',
  cpu: 'desc',
  ram: 'desc',
  disk: 'desc',
  updates: 'desc',
  agent: 'asc',
  seen: 'desc',
};

/** Problems first is the default: a list of thirty healthy machines is
 *  reassuring, but the one that needs attention should not be on page 2. */
export const DEFAULT_SORT: Sort = { key: 'status', dir: 'desc' };

/** `?sort=cpu` / `?sort=-cpu` ↔ Sort. Unknown values fall back to the default. */
export function parseSort(raw: string | null): Sort {
  if (!raw) return DEFAULT_SORT;
  const desc = raw.startsWith('-');
  const key = (desc ? raw.slice(1) : raw) as SortKey;
  return SORT_KEYS.includes(key) ? { key, dir: desc ? 'desc' : 'asc' } : DEFAULT_SORT;
}

export function formatSort(s: Sort): string | null {
  if (s.key === DEFAULT_SORT.key && s.dir === DEFAULT_SORT.dir) return null;
  return `${s.dir === 'desc' ? '-' : ''}${s.key}`;
}

/** Clicking a header: the same column flips, another column starts in its
 *  natural direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: FIRST_DIR[key] };
}

const SEVERITY = { danger: 4, warn: 3, off: 2, ok: 1, mdm: 1, noagent: 0 } as const;

export interface ListContext {
  patchSummary: PatchSummary;
  personName: (id: number | null) => string;
}

/** Name shown in the person column: the linked person, else the free-text
 *  owner label. */
export function ownerOf(d: Device, ctx: Pick<ListContext, 'personName'>): string {
  return ctx.personName(d.person_id) || d.owner_label || '';
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Pending updates, security ones weighted above any number of others. */
function updatesRank(d: Device, ps: PatchSummary): number | null {
  const p = ps[String(d.id)];
  if (!p) return null;
  return p.security * 100_000 + p.pending;
}

function value(d: Device, key: SortKey, ctx: ListContext): number | string | null {
  switch (key) {
    case 'name':
      return d.hostname;
    case 'status':
      return SEVERITY[deviceStatusKind(d)];
    case 'person':
      return ownerOf(d, ctx) || null;
    case 'cpu':
      return livePct(d, 'cpu_pct');
    case 'ram':
      return livePct(d, 'mem_pct');
    case 'disk':
      return diskPct(d);
    case 'updates':
      return updatesRank(d, ctx.patchSummary);
    case 'agent':
      return isAgent(d) && d.agent_version ? d.agent_version : null;
    case 'seen':
      return lastSeen(d);
  }
}

/**
 * Sorted copy. Missing values (an offline machine's CPU, a phone's agent
 * version) go last in either direction — "no measurement" is not the
 * smallest measurement. Ties fall back to the hostname, so the order is
 * stable while a poll refreshes the numbers underneath.
 */
export function sortDevices(devices: Device[], sort: Sort, ctx: ListContext): Device[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const keyed = devices.map((d) => ({ d, v: value(d, sort.key, ctx) }));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v === b.v) return collator.compare(a.d.hostname, b.d.hostname);
      return a.v === null ? 1 : -1;
    }
    let c: number;
    if (sort.key === 'agent') c = compareVersions(String(a.v), String(b.v));
    else if (typeof a.v === 'number' && typeof b.v === 'number') c = a.v - b.v;
    else c = collator.compare(String(a.v), String(b.v));
    return c !== 0 ? c * sign : collator.compare(a.d.hostname, b.d.hostname);
  });
  return keyed.map((k) => k.d);
}

// ---- Export -----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** TT.MM.JJJJ HH:MM — the form German spreadsheets read as a date. */
export function csvDate(ts: number | null): string {
  if (!ts) return '';
  const t = new Date(ts * 1000);
  return `${pad(t.getDate())}.${pad(t.getMonth() + 1)}.${t.getFullYear()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

const CSV_HEADER = [
  'Hostname',
  'Status',
  'Betriebssystem',
  'Version',
  'Person',
  'Tags',
  'CPU %',
  'RAM %',
  'Disk %',
  'Updates',
  'Davon Sicherheit',
  'Agent',
  'Zuletzt gesehen',
];

const round = (v: number | null) => (v === null ? null : Math.round(v));

/** The list as a CSV document, one row per device. */
export function toCsv(devices: Device[], ctx: ListContext): string {
  const rows = devices.map((d): CsvValue[] => {
    const p = ctx.patchSummary[String(d.id)];
    return [
      d.hostname,
      deviceStatusLabel(d),
      osLabel(d.os),
      d.os_version,
      ownerOf(d, ctx),
      d.tags.join(', '),
      round(livePct(d, 'cpu_pct')),
      round(livePct(d, 'mem_pct')),
      round(diskPct(d)),
      p ? p.pending : null,
      p ? p.security : null,
      isAgent(d) ? d.agent_version : '',
      csvDate(lastSeen(d)),
    ];
  });
  return toCsvDocument(CSV_HEADER, rows);
}

export function csvFileName(now = new Date()): string {
  return `vulpexa-devices-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
