/**
 * The fleet's update state as data: which system group a device belongs to,
 * which filter keeps it, how a column sorts and what the summary counts.
 * Kept apart from the page so each rule has one definition the tests can
 * hold on to.
 */
import { ApiError } from '../../api/client';
import { osLabel } from '../../format';
import type { Device, PatchSummary } from '../../types';

// ---- System groups ----------------------------------------------------------

export type OsCategory = 'win_pc' | 'win_server' | 'mac' | 'linux';
export type OsFilter = OsCategory | 'alle';

export const OS_CATEGORIES: OsCategory[] = ['win_pc', 'win_server', 'mac', 'linux'];

export const OS_CATEGORY_LABEL: Record<OsCategory, string> = {
  win_pc: 'Windows PC',
  win_server: 'Windows Server',
  mac: 'Mac',
  linux: 'Linux',
};

/** Windows splits by role: a server is patched on its own rhythm, and the
 *  `server` tag is how the fleet says which machine is one. */
export function categoryOf(d: Pick<Device, 'os' | 'tags'>): OsCategory {
  if (d.os === 'darwin') return 'mac';
  if (d.os === 'windows') return d.tags.includes('server') ? 'win_server' : 'win_pc';
  return 'linux';
}

export function isOsFilter(v: string | null): v is OsFilter {
  return v === 'alle' || OS_CATEGORIES.includes(v as OsCategory);
}

export function matchesOs(d: Pick<Device, 'os' | 'tags'>, f: OsFilter): boolean {
  return f === 'alle' || categoryOf(d) === f;
}

// ---- Per-device figures -----------------------------------------------------

/** A scan older than this no longer says what is open on the device. The
 *  server asks every connected agent once a day. */
export const STALE_AFTER_S = 24 * 3600;

/** Pending updates, or null while nobody has looked. The summary only lists
 *  devices with something open, so a missing entry means "nothing open" —
 *  but only once a scan has actually arrived. */
export function pendingOf(d: Device, ps: PatchSummary): number | null {
  const p = ps[String(d.id)];
  if (p) return p.pending;
  return d.last_patch_scan_at > 0 ? 0 : null;
}

export function securityOf(d: Device, ps: PatchSummary): number {
  return ps[String(d.id)]?.security ?? 0;
}

export function neverScanned(d: Device): boolean {
  return d.last_patch_scan_at <= 0;
}

/** No scan in the last 24 hours, or none at all. */
export function scanStale(d: Device, now: number): boolean {
  return neverScanned(d) || now - d.last_patch_scan_at >= STALE_AFTER_S;
}

/** Scanned and nothing open. A device that never reported is not current,
 *  it is unknown. */
export function isCurrent(d: Device, ps: PatchSummary): boolean {
  return pendingOf(d, ps) === 0;
}

// ---- Status filter ----------------------------------------------------------

export type StateFilter = 'alle' | 'sicherheit' | 'offen' | 'aktuell' | 'ungeprueft';

export const STATE_FILTERS: StateFilter[] = ['alle', 'sicherheit', 'offen', 'aktuell', 'ungeprueft'];

export const STATE_LABEL: Record<StateFilter, string> = {
  alle: 'Alle',
  sicherheit: 'Sicherheitsupdates',
  offen: 'Updates offen',
  aktuell: 'Aktuell',
  ungeprueft: 'Nicht geprüft',
};

export function isStateFilter(v: string | null): v is StateFilter {
  return STATE_FILTERS.includes(v as StateFilter);
}

/** One predicate per filter, so the count on a filter and the rows below it
 *  never say different things. */
export function matchesState(d: Device, f: StateFilter, ps: PatchSummary, now: number): boolean {
  switch (f) {
    case 'sicherheit':
      return securityOf(d, ps) > 0;
    case 'offen':
      return (pendingOf(d, ps) ?? 0) > 0;
    case 'aktuell':
      return isCurrent(d, ps);
    case 'ungeprueft':
      return scanStale(d, now);
    default:
      return true;
  }
}

// ---- Connection filter ------------------------------------------------------

export type ConnFilter = 'alle' | 'verbunden' | 'offline';

export function isConnFilter(v: string | null): v is ConnFilter {
  return v === 'alle' || v === 'verbunden' || v === 'offline';
}

/** Follows the live socket, not `online`: a scan or an installation reaches
 *  a device only through an open connection. */
export function matchesConn(d: Device, f: ConnFilter): boolean {
  if (f === 'verbunden') return d.connected;
  if (f === 'offline') return !d.connected;
  return true;
}

// ---- Search -----------------------------------------------------------------

/** Name shown in the person column: the linked person, else the free-text
 *  owner label. */
export function ownerOf(d: Device, personName: (id: number | null) => string): string {
  return personName(d.person_id) || d.owner_label || '';
}

export function matchesQuery(d: Device, query: string, owner: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${d.hostname} ${owner} ${d.tags.join(' ')} ${osLabel(d.os)} ${d.os_version} ${OS_CATEGORY_LABEL[categoryOf(d)]}`;
  return hay.toLowerCase().includes(q);
}

// ---- Sorting ----------------------------------------------------------------

export type SortKey = 'name' | 'person' | 'pending' | 'security' | 'scan' | 'conn';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

const SORT_KEYS: SortKey[] = ['name', 'person', 'pending', 'security', 'scan', 'conn'];

/** The direction a column sorts in on its first click: the one that answers
 *  the question the column is for — most open first, longest unchecked
 *  first, unreachable first. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  person: 'asc',
  pending: 'desc',
  security: 'desc',
  scan: 'asc',
  conn: 'asc',
};

/** Security first: thirty pending feature updates matter less than one open
 *  security fix. */
export const DEFAULT_SORT: Sort = { key: 'security', dir: 'desc' };

/** `?sort=pending` / `?sort=-pending` ↔ Sort. Unknown values fall back to
 *  the default. */
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

export interface ListContext {
  patchSummary: PatchSummary;
  personName: (id: number | null) => string;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

function value(d: Device, key: SortKey, ctx: ListContext): number | string | null {
  switch (key) {
    case 'name':
      return d.hostname;
    case 'person':
      return ownerOf(d, ctx.personName) || null;
    case 'pending':
      return pendingOf(d, ctx.patchSummary);
    case 'security': {
      // Security count first, the rest of the pending updates as tie-breaker.
      const pending = pendingOf(d, ctx.patchSummary);
      return pending === null ? null : securityOf(d, ctx.patchSummary) * 100_000 + pending;
    }
    case 'scan':
      // Never scanned is the oldest scan there is, not a missing value.
      return Math.max(0, d.last_patch_scan_at);
    case 'conn':
      return d.connected ? 1 : 0;
  }
}

/**
 * Sorted copy. Unknown values (the updates of a device that never reported)
 * go last in either direction — "not known" is not the smallest count. Ties
 * fall back to the hostname, so the order holds still while a refresh
 * changes the numbers underneath.
 */
export function sortDevices(devices: Device[], sort: Sort, ctx: ListContext): Device[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const keyed = devices.map((d) => ({ d, v: value(d, sort.key, ctx) }));
  keyed.sort((a, b) => {
    if (a.v === null || b.v === null) {
      if (a.v === b.v) return collator.compare(a.d.hostname, b.d.hostname);
      return a.v === null ? 1 : -1;
    }
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
    return c !== 0 ? c * sign : collator.compare(a.d.hostname, b.d.hostname);
  });
  return keyed.map((k) => k.d);
}

// ---- Summary ----------------------------------------------------------------

export interface PatchStats {
  devices: number;
  /** Devices with at least one pending update. */
  withPending: number;
  pending: number;
  security: number;
  securityDevices: number;
  /** No scan in 24 hours, never-scanned included. */
  stale: number;
  never: number;
  current: number;
}

export function patchStats(devices: Device[], ps: PatchSummary, now: number): PatchStats {
  const s: PatchStats = { devices: devices.length, withPending: 0, pending: 0, security: 0, securityDevices: 0, stale: 0, never: 0, current: 0 };
  for (const d of devices) {
    const pending = pendingOf(d, ps) ?? 0;
    const security = securityOf(d, ps);
    s.pending += pending;
    s.security += security;
    if (pending > 0) s.withPending += 1;
    if (security > 0) s.securityDevices += 1;
    if (scanStale(d, now)) s.stale += 1;
    if (neverScanned(d)) s.never += 1;
    if (isCurrent(d, ps)) s.current += 1;
  }
  return s;
}

/** Share of current devices in whole percent, rounded down: 100 % only when
 *  every device is current, never because 199 of 200 round up. */
export function currentPct(current: number, total: number): number {
  return total === 0 ? 0 : Math.floor((current / total) * 100);
}

/** Thresholds of the old patch rings, kept: from 90 % a group is in good
 *  shape, below 60 % it needs attention. */
export function currentLevel(pct: number): 'ok' | 'warn' | 'crit' {
  if (pct >= 90) return 'ok';
  if (pct >= 60) return 'warn';
  return 'crit';
}

export interface CategoryStat {
  id: OsCategory;
  total: number;
  current: number;
  /** Open updates across the group, and how many of them are security. */
  pending: number;
  security: number;
  /** Devices with at least one security update open. */
  securityDevices: number;
  /** No scan in 24 hours, never-scanned included. */
  stale: number;
}

/** The summary per system group, for the groups the fleet has. Same
 *  counting as `patchStats`, so a card and the figures above never
 *  disagree. */
export function categoryStats(devices: Device[], ps: PatchSummary, now: number): CategoryStat[] {
  return OS_CATEGORIES.map((id) => {
    const s = patchStats(
      devices.filter((d) => categoryOf(d) === id),
      ps,
      now,
    );
    return {
      id,
      total: s.devices,
      current: s.current,
      pending: s.pending,
      security: s.security,
      securityDevices: s.securityDevices,
      stale: s.stale,
    };
  }).filter((c) => c.total > 0);
}

// ---- Wording ----------------------------------------------------------------

const fmt = new Intl.NumberFormat('de-DE');

/** "1 Gerät", "3 Geräten" — the dative the copy around it needs. */
export function onDevices(n: number): string {
  return `${fmt.format(n)} ${n === 1 ? 'Gerät' : 'Geräten'}`;
}

/** What an empty list says. With only the status filter set, the answer is
 *  good news and is said as such. */
export function emptyText(state: StateFilter, narrowedOtherwise: boolean): { title: string; text: string | null } {
  if (!narrowedOtherwise) {
    switch (state) {
      case 'sicherheit':
        return { title: 'Keine offenen Sicherheitsupdates', text: 'Auf keinem Gerät wartet gerade ein Sicherheitsupdate.' };
      case 'offen':
        return { title: 'Keine offenen Updates', text: 'Jedes geprüfte Gerät ist auf dem neuesten Stand.' };
      case 'aktuell':
        return { title: 'Kein Gerät ist vollständig aktuell', text: 'Jedes Gerät hat offene Updates oder wurde noch nie geprüft.' };
      case 'ungeprueft':
        return { title: 'Alle Geräte sind geprüft', text: 'Jedes Gerät hat in den letzten 24 Stunden seinen Update-Stand gemeldet.' };
      default:
        break;
    }
  }
  return { title: 'Keine Geräte gefunden', text: narrowedOtherwise ? 'Kein Gerät passt zu Filter und Suche zusammen.' : null };
}

/** A 403 means the role changed under an open page; that is said in words,
 *  never as the raw response. */
export function isForbidden(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403;
}

export const FORBIDDEN_TEXT = 'Prüfen und Installieren ist Administratoren und Technikern vorbehalten.';

// ---- iPhone and iPad (MDM) ---------------------------------------------------

export interface IosStat {
  total: number;
  current: number;
  majorBehind: number;
  outdated: number;
  /** No answer from Apple's catalogue or the phone yet. */
  unknown: number;
  /** Phones behind, worst first — the card links them. */
  behind: Device[];
}

/** iOS state of the phones under MDM, from the server's comparison with
 *  Apple's catalogue (backend/app/ios_versions.py). A phone on the newest
 *  release of an older major version counts as current for its security,
 *  so the ring only counts outdated ones against it. */
export function iosStats(phones: Device[]): IosStat {
  const s: IosStat = { total: phones.length, current: 0, majorBehind: 0, outdated: 0, unknown: 0, behind: [] };
  for (const d of phones) {
    const st = d.mdm?.os_status ?? 'unknown';
    if (st === 'current') s.current += 1;
    else if (st === 'major_behind') s.majorBehind += 1;
    else if (st === 'outdated') s.outdated += 1;
    else s.unknown += 1;
  }
  s.behind = phones
    .filter((d) => d.mdm?.os_status === 'outdated' || d.mdm?.os_status === 'major_behind')
    .sort((a, b) => (a.mdm?.os_status === 'outdated' ? 0 : 1) - (b.mdm?.os_status === 'outdated' ? 0 : 1));
  return s;
}
