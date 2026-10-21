/**
 * The audit log as data: what the filters in the address mean, how a page of
 * events is grouped and laid out, and what an export contains. Kept apart
 * from the page so each rule has one definition the tests can hold on to.
 */
import { AUDIT_CATEGORY, auditCategoryLabel, auditDayLabel, describeAudit, type AuditNames } from '../../auditText';
import type { AuditCategory, AuditEvent } from '../../types';
import { toCsvDocument, type CsvValue } from '../../csv';

// ---- Filters ----------------------------------------------------------------

export type Range = '24h' | '7d' | '30d' | 'alle';

export const RANGES: Range[] = ['24h', '7d', '30d', 'alle'];

/** A week: long enough to answer "what happened since last Monday", short
 *  enough that the first page is about now. */
export const DEFAULT_RANGE: Range = '7d';

export const RANGE_LABEL: Record<Range, string> = {
  '24h': '24 h',
  '7d': '7 Tage',
  '30d': '30 Tage',
  alle: 'Alles',
};

/** "Keine Einträge in …" — the span a range covers, as a phrase. */
export const RANGE_SPAN: Record<Exclude<Range, 'alle'>, string> = {
  '24h': 'den letzten 24 Stunden',
  '7d': 'den letzten 7 Tagen',
  '30d': 'den letzten 30 Tagen',
};

const RANGE_SECONDS: Record<Range, number | null> = {
  '24h': 86_400,
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
  alle: null,
};

export function isRange(v: string | null): v is Range {
  return RANGES.includes(v as Range);
}

/** Start of the range in epoch seconds; undefined for "Alles". The client
 *  computes it so the server never has to know a time zone. */
export function sinceFor(range: Range, now: number): number | undefined {
  const s = RANGE_SECONDS[range];
  return s === null ? undefined : now - s;
}

export const CATEGORY_IDS = Object.keys(AUDIT_CATEGORY) as AuditCategory[];

export function isCategory(v: string | null): v is AuditCategory {
  return CATEGORY_IDS.includes(v as AuditCategory);
}

/** What the server is asked for, besides the search text and the page. */
export interface AuditFilters {
  range: Range;
  security: boolean;
  category: AuditCategory | '';
  actor: string;
}

/**
 * The filters as the address states them. Unknown values fall back to the
 * default. The server ignores the category when "Nur Sicherheit" is on, so
 * the page does too — a disabled select still showing "Jobs" would claim a
 * filter that is not applied.
 */
export function readFilters(params: URLSearchParams): AuditFilters {
  const rawRange = params.get('range');
  const rawCategory = params.get('category');
  const security = params.get('security') === '1';
  return {
    range: isRange(rawRange) ? rawRange : DEFAULT_RANGE,
    security,
    category: !security && isCategory(rawCategory) ? rawCategory : '',
    actor: params.get('actor') ?? '',
  };
}

/** The server refuses a longer search with a 422 (q: max_length=200 in
 *  backend/app/routers/audit.py). */
export const SEARCH_MAX = 200;

/** The search the address asks for, cut to what the server accepts — a
 *  pasted link with a longer one would otherwise fail on every reload.
 *  Counted in code points, as the server counts. */
export function readSearch(params: URLSearchParams): string {
  return Array.from((params.get('q') ?? '').trim())
    .slice(0, SEARCH_MAX)
    .join('');
}

/** Any filter besides the time range. */
export function hasFilters(f: AuditFilters, search: string): boolean {
  return f.security || f.category !== '' || f.actor !== '' || search !== '';
}

/** Does the view differ from what the page opens with? */
export function isNarrowed(f: AuditFilters, search: string): boolean {
  return hasFilters(f, search) || f.range !== DEFAULT_RANGE;
}

// ---- Layout -----------------------------------------------------------------

export interface DayGroup {
  day: string;
  events: AuditEvent[];
}

/** Consecutive events by local day, in the order the server sent them. A page
 *  that spans midnight reads as two days instead of one run of times. */
export function groupByDay(events: AuditEvent[], label: (ts: number) => string = auditDayLabel): DayGroup[] {
  const out: DayGroup[] = [];
  for (const e of events) {
    const day = label(e.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** HH:MM:SS — an audit trail is read to the second. */
export function timeOfDay(ts: number): string {
  const t = new Date(ts * 1000);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

/** Who acted. Events the server raises on its own carry no actor. */
export function actorLabel(e: AuditEvent): string {
  return e.actor || 'System';
}

/** The device an event concerns, by name: the one stored with the event (the
 *  device may be gone since), else the live fleet, else the id. */
export function deviceName(e: AuditEvent, names: AuditNames): string | null {
  if (e.device_id === null) return null;
  const stored = e.detail.hostname;
  if (typeof stored === 'string' && stored) return stored;
  return names.device?.(e.device_id) ?? `Gerät ${e.device_id}`;
}

/** German names for the detail fields the server writes most. Anything else
 *  keeps its field name, shown as the identifier it is. */
const DETAIL_LABEL: Record<string, string> = {
  hostname: 'Hostname',
  command: 'Befehl',
  ip: 'IP-Adresse',
  username: 'Benutzername',
  role: 'Rolle',
  label: 'Bezeichnung',
  script: 'Skript',
  script_id: 'Skript-ID',
  name: 'Name',
  count: 'Anzahl',
  os: 'Betriebssystem',
  kind: 'Art',
  minutes: 'Minuten',
  message: 'Meldung',
  rule: 'Regel',
  rule_id: 'Regel-ID',
  job_id: 'Auftrags-ID',
  sched_id: 'Zeitplan-ID',
  cred_id: 'Passwort-ID',
  person_id: 'Personen-ID',
  token_id: 'Token-ID',
  version: 'Version',
};

/** Values that are commands or addresses: set in the code face, verbatim. */
const CODE_FIELDS = new Set(['command', 'ip']);

export interface DetailRow {
  key: string;
  /** German label, or null when the field has none and shows its key. */
  label: string | null;
  value: string;
  /** Command, address or structured value — rendered in the code face. */
  code: boolean;
}

/** The detail blob, one row per field. The interesting fields differ per
 *  event, so there is nothing to lay out in advance — but hiding them was
 *  worse: "Befehl auf Gerät 4" without the command is not an audit trail. */
export function detailRows(e: AuditEvent): DetailRow[] {
  return Object.entries(e.detail).map(([key, v]) => {
    const structured = v !== null && typeof v === 'object';
    let value: string;
    if (v === null || v === undefined || v === '') value = '—';
    else if (typeof v === 'string') value = v;
    else if (typeof v === 'boolean') value = v ? 'ja' : 'nein';
    else if (structured) value = JSON.stringify(v);
    else value = String(v);
    return { key, label: DETAIL_LABEL[key] ?? null, value, code: structured || CODE_FIELDS.has(key) };
  });
}

// ---- Export -----------------------------------------------------------------

/** TT.MM.JJJJ HH:MM:SS — the form German spreadsheets read as a date. */
export function csvDateTime(ts: number): string {
  const t = new Date(ts * 1000);
  return `${pad(t.getDate())}.${pad(t.getMonth() + 1)}.${t.getFullYear()} ${timeOfDay(ts)}`;
}

const CSV_HEADER = [
  'Zeitpunkt',
  'Akteur',
  'Kategorie',
  'Ereignis',
  'Beschreibung',
  'Gerät',
  'Geräte-ID',
  'Sicherheitsrelevant',
  'Details',
];

/** The page as a CSV document. The detail blob goes along as JSON, so
 *  nothing the screen shows is lost. */
export function toCsv(events: AuditEvent[], names: AuditNames): string {
  const rows = events.map((e): CsvValue[] => [
      csvDateTime(e.ts),
      actorLabel(e),
      auditCategoryLabel(e.category),
      e.event,
      describeAudit(e, names),
      deviceName(e, names),
      e.device_id,
      e.security ? 'ja' : 'nein',
      Object.keys(e.detail).length > 0 ? JSON.stringify(e.detail) : '',
  ]);
  return toCsvDocument(CSV_HEADER, rows);
}

/** Today's date, and the page when it is not the first — two exports of the
 *  same day should not overwrite each other in the downloads folder. */
export function csvFileName(page = 1, now = new Date()): string {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `vulpexa-audit-${day}${page > 1 ? `-seite-${page}` : ''}.csv`;
}
