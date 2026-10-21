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

/** One address: no spaces and exactly one @. Deliberately loose — this
 *  decides only whether to offer a link, not whether the value is valid. */
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

/**
 * A mailto: link for the email field, or null when the field holds no
 * address list to write to („über Tochter“). The field is free text on the
 * server, so the check happens here. RFC 6068 wants ?, #, % and & in an
 * address percent-encoded; raw, the mail client reads them as headers or a
 * fragment and writes to someone else.
 */
export function mailtoHref(email: string): string | null {
  const parts = email
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => ADDRESS.test(p))) return null;
  return `mailto:${parts.map((p) => encodeURIComponent(p).replace(/%40/g, '@')).join(',')}`;
}

/** A number as people write one: an optional plus or opening bracket, a
 *  digit, then digits with spaces, brackets, slashes, dots and dashes. */
const NUMBER_RUN = /\+?\(?\d[\d\s()/.\-–]*/g;
/** A slash followed by a new prefix starts a second number („0711 123456 /
 *  0171 9876543“). A German subscriber number never starts with 0, so the
 *  slash in „0711 / 123456“ stays inside one number. */
const NEXT_NUMBER = /\s*\/\s*(?=[+0])/;
/** Fewer digits than this is a room or an extension, not a number to dial. */
const MIN_DIGITS = 3;

export interface PhoneLink {
  /** Text before the number, e.g. „Büro: “. */
  before: string;
  /** The number as written; this part becomes the link. */
  number: string;
  /** Anything after it, e.g. a second number or „(abends)“. */
  after: string;
  href: string;
}

/**
 * The first dialable number in a free-text phone field, split out so only
 * that number is linked. The field takes any text (the server does not
 * check it), so this keeps a plus and the digits, drops the separators
 * people type, and leaves text without a number unlinked.
 */
export function phoneLink(phone: string): PhoneLink | null {
  for (const m of phone.matchAll(NUMBER_RUN)) {
    let number = m[0];
    const next = NEXT_NUMBER.exec(number);
    if (next) number = number.slice(0, next.index);
    number = number.replace(/[\s(/.\-–]+$/, '');
    const intl = number.startsWith('+');
    // „+49 (0)711 …“: the bracketed trunk 0 is dialled only from inside the
    // country; with the country code in front it makes a wrong number.
    const digits = (intl ? number.replace(/\(\s*0\s*\)/, '') : number).replace(/\D/g, '');
    if (digits.length < MIN_DIGITS) continue;
    return {
      before: phone.slice(0, m.index),
      number,
      after: phone.slice(m.index + number.length),
      href: `tel:${intl ? '+' : ''}${digits}`,
    };
  }
  return null;
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
  const kinds = devices.map((d) => deviceStatusKind(d));
  const count = (k: StatusKind) => kinds.filter((x) => x === k).length;
  const devs = (n: number) => plural(n, 'Gerät', 'Geräte');
  if (count('danger') > 0) return { kind: 'danger', label: `${devs(count('danger'))} kritisch` };
  if (openAlerts > 0) return { kind: 'warn', label: plural(openAlerts, 'offener Alarm', 'offene Alarme') };
  if (count('warn') > 0) return { kind: 'warn', label: `${devs(count('warn'))} mit Warnung` };
  if (count('off') > 0) return { kind: 'off', label: `${devs(count('off'))} offline` };
  if (count('noagent') + count('mdm') === devices.length) return { kind: 'neutral', label: 'Nur Geräte ohne Agent' };
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

/** Every account linked to the person. Deleting the person acts on all of
 *  them (users_for_person in routers/persons.py), not just the first. */
export function accountsOf(accounts: Account[], personId: number): Account[] {
  return accounts.filter((a) => a.person_id === personId);
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
