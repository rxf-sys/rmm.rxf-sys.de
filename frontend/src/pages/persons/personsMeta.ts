/** Arithmetic and wording of the persons page, kept apart from the
 *  components so it can be tested without rendering anything. */
import { ApiError } from '../../api/client';
import { deviceStatusKind } from '../../deviceStatus';
import type { Account, Alert, AuditEvent, Device, PatchSummary, Person } from '../../types';
import type { StatusKind } from '../../ui';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** First letter of a name for the avatar; a code point, so "Ömer" and
 *  names starting with an emoji keep their first character whole. */
export function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

/** "a", "a und b", "a, b und c", "a, b, c und 4 weitere". */
export function nameList(names: string[], max = 4): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} und ${names.length - max} weitere`;
}

/** An absolute day as TT.MM.JJJJ. */
export function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** A dialable number: keeps a leading plus and the digits, drops the
 *  spaces, slashes and dashes people write numbers with. */
export function telHref(phone: string): string {
  const t = phone.trim();
  return `tel:${t.startsWith('+') ? '+' : ''}${t.replace(/\D/g, '')}`;
}

// ---- Fleet state of one person ----------------------------------------

export interface PersonFacts {
  devices: number;
  online: number;
  openAlerts: number;
  pending: number;
  security: number;
}

/** Alerts still open on these devices, newest first. */
export function openAlertsOn(devices: Device[], alerts: Alert[]): Alert[] {
  const ids = new Set(devices.map((d) => d.id));
  return alerts.filter((a) => a.resolved_at === null && ids.has(a.device_id)).sort((a, b) => b.fired_at - a.fired_at);
}

/** Counters for one person, given only that person's devices. */
export function personFacts(devices: Device[], alerts: Alert[], summary: PatchSummary): PersonFacts {
  let pending = 0;
  let security = 0;
  for (const d of devices) {
    const s = summary[String(d.id)];
    if (!s) continue;
    pending += s.pending;
    security += s.security;
  }
  return {
    devices: devices.length,
    online: devices.filter((d) => d.online).length,
    openAlerts: openAlertsOn(devices, alerts).length,
    pending,
    security,
  };
}

export interface Verdict {
  kind: StatusKind;
  label: string;
}

/**
 * One line on how a person's devices are doing, worst first. Offline ranks
 * below an open alert: a shut-down family laptop is normal, and when its
 * being offline matters an alert rule says so.
 */
export function personVerdict(devices: Device[], openAlerts: number): Verdict {
  if (devices.length === 0) return { kind: 'neutral', label: 'Kein Gerät' };
  const kinds = devices.map(deviceStatusKind);
  const count = (k: StatusKind) => kinds.filter((x) => x === k).length;
  const devs = (n: number) => plural(n, 'Gerät', 'Geräte');
  if (count('danger') > 0) return { kind: 'danger', label: `${devs(count('danger'))} kritisch` };
  if (openAlerts > 0) return { kind: 'warn', label: plural(openAlerts, 'offener Alarm', 'offene Alarme') };
  if (count('warn') > 0) return { kind: 'warn', label: `${devs(count('warn'))} mit Warnung` };
  if (count('off') > 0) return { kind: 'off', label: `${devs(count('off'))} offline` };
  if (count('noagent') === devices.length) return { kind: 'neutral', label: 'Nur Geräte ohne Agent' };
  return { kind: 'ok', label: 'Alles in Ordnung' };
}

/** Something on this person's devices wants a look. */
export const needsAttention = (v: Verdict) => v.kind === 'danger' || v.kind === 'warn';

// ---- List ----------------------------------------------------------------

export type PersonFilter = 'alle' | 'befund' | 'ohne';

export function isPersonFilter(v: string | null): v is PersonFilter {
  return v === 'alle' || v === 'befund' || v === 'ohne';
}

export interface PersonRow {
  person: Person;
  devices: Device[];
  verdict: Verdict;
}

/** Each person with their devices and verdict, alphabetical. */
export function personRows(persons: Person[], devices: Device[], alerts: Alert[]): PersonRow[] {
  const byPerson = new Map<number, Device[]>();
  for (const d of devices) {
    if (d.person_id === null) continue;
    const list = byPerson.get(d.person_id);
    if (list) list.push(d);
    else byPerson.set(d.person_id, [d]);
  }
  return persons
    .map((person) => {
      const own = byPerson.get(person.id) ?? [];
      return { person, devices: own, verdict: personVerdict(own, openAlertsOn(own, alerts).length) };
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'de'));
}

/** Search covers contact data and hostnames, so "wem gehört laptop-3?" is
 *  answered by typing the hostname. */
export function matchesPerson(row: PersonRow, q: string, filter: PersonFilter): boolean {
  if (filter === 'befund' && !needsAttention(row.verdict)) return false;
  if (filter === 'ohne' && row.devices.length > 0) return false;
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const p = row.person;
  const hay = [p.name, p.email, p.phone, p.notes, ...row.devices.map((d) => d.hostname)].join(' ').toLowerCase();
  return hay.includes(query);
}

// ---- Account and activity -------------------------------------------------

export function accountFor(accounts: Account[] | undefined, personId: number): Account | null {
  return accounts?.find((a) => a.person_id === personId) ?? null;
}

/** An event belongs to a person if their account did it, or if it happened
 *  on one of their devices. */
export function personActivity(events: AuditEvent[], account: Account | null, devices: Device[], limit = 8): AuditEvent[] {
  const ids = new Set(devices.map((d) => d.id));
  return events
    .filter((e) => (account !== null && e.actor === account.username) || (e.device_id !== null && ids.has(e.device_id)))
    .slice(0, limit);
}

/** What deleting the person does to the linked account — the server deletes
 *  a viewer account and only unlinks any higher role (routers/persons.py). */
export function accountFate(account: Account | null): 'deleted' | 'unlinked' | null {
  if (!account) return null;
  return account.role === 'viewer' ? 'deleted' : 'unlinked';
}

// ---- Editing ----------------------------------------------------------------

export interface Draft {
  id: number | null;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

export const EMPTY_DRAFT: Draft = { id: null, name: '', email: '', phone: '', notes: '' };

/** Limits of PersonRequest in routers/persons.py, so the form stops where
 *  the server would refuse. */
export const LIMITS = { name: 120, email: 200, phone: 60, notes: 2000 } as const;

export function draftBody(d: Draft) {
  return { name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), notes: d.notes.trim() };
}

/** The server answers a missing role with an English 403; say who may do
 *  it instead. Anything else passes through unchanged. */
export function explainError(e: unknown, forbidden: string): unknown {
  return e instanceof ApiError && e.status === 403 ? new Error(forbidden) : e;
}
