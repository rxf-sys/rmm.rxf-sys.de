/**
 * The alert centre as data: which tab an alert belongs in, how urgent it is,
 * in which order the list runs, and what a round of acknowledgements
 * achieved. Kept apart from the page so each rule has one definition the
 * tests can hold on to.
 */
import { ApiError } from '../../api/client';
import { alertStatusKind } from '../../deviceStatus';
import { formatAgo } from '../../format';
import type { Alert, Device } from '../../types';
import type { StatusKind } from '../../ui';
import type { BulkOutcome } from '../devices/bulk';

// ---- Tabs -------------------------------------------------------------------

export type Tab = 'offen' | 'quittiert' | 'behoben';

export const TABS: Tab[] = ['offen', 'quittiert', 'behoben'];

export const TAB_LABEL: Record<Tab, string> = {
  offen: 'Offen',
  quittiert: 'Quittiert',
  behoben: 'Behoben',
};

export function isTab(v: string | null): v is Tab {
  return TABS.includes(v as Tab);
}

/** Open until someone acknowledges it, acknowledged until its cause is gone.
 *  A resolved alert is history, whether anyone saw it or not. */
export function tabOf(a: Alert): Tab {
  if (a.resolved_at !== null) return 'behoben';
  return a.acked_at === null ? 'offen' : 'quittiert';
}

export function countTabs(list: Alert[]): Record<Tab, number> {
  const out: Record<Tab, number> = { offen: 0, quittiert: 0, behoben: 0 };
  for (const a of list) out[tabOf(a)] += 1;
  return out;
}

// ---- Urgency ----------------------------------------------------------------

/**
 * How long a condition may last before it is no longer a blip but a state.
 * A server that has not answered for a minute is a notice; one gone since
 * yesterday is the first thing to look at. The overdue-update rule only
 * fires after its own grace period (30 days by default), so by the time it
 * does, nothing about it is fresh.
 */
const LONG_STANDING_AFTER_S: Record<string, number> = {
  offline: 24 * 3600,
  disk: 6 * 3600,
  patch_age: 0,
};

export function isLongStanding(a: Alert, now: number): boolean {
  const after = LONG_STANDING_AFTER_S[a.rule];
  return after !== undefined && now - a.fired_at >= after;
}

/**
 * Rank in the list, lower first: critical by the device's state right now,
 * then critical by how long it has lasted, then everything else. The badge
 * shows the first; the second only moves a row up, so a "Kritisch" badge
 * never sits below a "Warnung" that merely got old.
 */
export function urgency(a: Alert, device: Device | undefined, now: number): 0 | 1 | 2 {
  if (alertStatusKind(a, device) === 'danger') return 0;
  return isLongStanding(a, now) ? 1 : 2;
}

export interface AlertContext {
  deviceOf: (id: number) => Device | undefined;
  now: number;
}

const TAB_RANK: Record<Tab, number> = { offen: 0, quittiert: 1, behoben: 2 };

/**
 * Unacknowledged before acknowledged before resolved; within those the most
 * urgent first and, at equal urgency, the newest. Resolved alerts run by when
 * they cleared — what matters about them is what just got better.
 */
export function sortAlerts(list: Alert[], ctx: AlertContext): Alert[] {
  const keyed = list.map((a) => {
    const tab = tabOf(a);
    return {
      a,
      tab: TAB_RANK[tab],
      rank: tab === 'behoben' ? 0 : urgency(a, ctx.deviceOf(a.device_id), ctx.now),
      ts: a.resolved_at ?? a.fired_at,
    };
  });
  keyed.sort((x, y) => x.tab - y.tab || x.rank - y.rank || y.ts - x.ts || y.a.id - x.a.id);
  return keyed.map((k) => k.a);
}

// ---- Presentation -----------------------------------------------------------

const KIND_LABEL = { off: 'Offline', danger: 'Kritisch', warn: 'Warnung' } as const;

/** The badge of an alert: what the device's state says about it while it is
 *  open, a plain "Behoben" once it is history — a cleared disk alert must
 *  not keep saying "Kritisch" because the disk filled up again since. A
 *  page of history stays quiet, so that one goes without its pill. */
export function alertBadge(a: Alert, device: Device | undefined): { kind: StatusKind; label: string; plain?: boolean } {
  if (a.resolved_at !== null) return { kind: 'ok', label: 'Behoben', plain: true };
  const kind = alertStatusKind(a, device);
  return { kind, label: KIND_LABEL[kind] };
}

/** How long a resolved alert was open, short enough for a line of metadata. */
export function openFor(a: Alert): string {
  if (a.resolved_at === null) return '';
  const s = Math.max(0, a.resolved_at - a.fired_at);
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} Min.`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} Std.`;
  return `${Math.round(s / 86400)} Tage`;
}

/** formatAgo inside a sentence: "quittiert vor 3 h", but "quittiert am
 *  02.10.2026" once the distance has turned into a date. */
export function agoPhrase(ts: number, now: number): string {
  const s = formatAgo(ts, now);
  return /^\d/.test(s) ? `am ${s}` : s;
}

/** The first few of a list and how many are left: a dialog names what it
 *  acts on, but a hundred lines would bury the button. One left over is
 *  shown rather than counted — "und 1 weitere" saves no room. */
export function preview<T>(list: T[], max: number): { head: T[]; rest: number } {
  if (list.length <= max + 1) return { head: list, rest: 0 };
  return { head: list.slice(0, max), rest: list.length - max };
}

// ---- Where an empty list comes from -----------------------------------------

export type ListState = 'loading' | 'failed' | 'ready';

/**
 * Whether an empty list means "nothing there" or "not here yet". The fleet's
 * cache entry for the alerts knows. Without one (nothing has registered the
 * query) a fleet with neither devices nor alerts counts as not loaded: a
 * dashboard like that is far more often starting up than empty.
 */
export function listState(
  alerts: number,
  devices: number,
  cached: { status: 'pending' | 'error' | 'success'; data: unknown } | undefined,
): ListState {
  if (alerts > 0) return 'ready';
  if (!cached) return devices > 0 ? 'ready' : 'loading';
  if (cached.data !== undefined) return 'ready';
  return cached.status === 'error' ? 'failed' : 'loading';
}

// ---- Acknowledging ----------------------------------------------------------

/**
 * Why an acknowledgement did not go through. A 404 means the alert is no
 * longer open — it cleared between the last poll and the click, which is not
 * a failure: there is nothing left to acknowledge. The server answers a
 * viewer's foreign alert with 404 as well, so a 403 only comes from a
 * session that lost its rights.
 */
export function ackFailure(e: unknown): 'gone' | 'denied' | 'error' {
  if (e instanceof ApiError && e.status === 404) return 'gone';
  if (e instanceof ApiError && e.status === 403) return 'denied';
  return 'error';
}

/** Alerts a confirmation named that were not sent after all. */
export interface AckSkipped {
  /** Acknowledged meanwhile, by someone else or by a click on its own row. */
  acked: number;
  /** Cleared meanwhile, or gone from the list. */
  resolved: number;
}

const NOTHING_SKIPPED: AckSkipped = { acked: 0, resolved: 0 };

/**
 * Of the alerts a confirmation named, the ones still to send once it comes
 * back. The dialog can stay open across a poll; an alert acknowledged in
 * the meantime is not sent again — the server would record a second
 * acknowledgement under this account's name — and neither is one whose own
 * acknowledge is still running.
 */
export function stillToAck(
  named: Alert[],
  current: Alert[],
  inFlight: ReadonlySet<number>,
): { send: Alert[]; skipped: AckSkipped } {
  const byId = new Map(current.map((a) => [a.id, a]));
  const send: Alert[] = [];
  const skipped = { acked: 0, resolved: 0 };
  for (const a of named) {
    const now = byId.get(a.id);
    if (now === undefined || tabOf(now) === 'behoben') skipped.resolved += 1;
    else if (tabOf(now) === 'quittiert' || inFlight.has(a.id)) skipped.acked += 1;
    else send.push(a);
  }
  return { send, skipped };
}

export interface AckReport {
  tone: 'success' | 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
  /** For `error`: the first failure, for its message. */
  error?: unknown;
}

const was = (n: number) => `${n} ${n === 1 ? 'war' : 'waren'}`;

/** One toast for a round of acknowledgements, single or bulk. `describe`
 *  names the alert when there was only one; `skipped` counts what the
 *  round left out because it was no longer open. */
export function ackReport(
  outcome: BulkOutcome<Alert>,
  describe: (a: Alert) => string,
  skipped: AckSkipped = NOTHING_SKIPPED,
): AckReport {
  const total = outcome.ok.length + outcome.failed.length;
  // One request is "Nicht quittiert", not "1 von 1"; but a round that left
  // others out is still a round, and its toast says what became of them.
  const one = total === 1;
  const single = one && skipped.acked + skipped.resolved === 0;
  const gone = outcome.failed.filter((f) => ackFailure(f.error) === 'gone').length + skipped.resolved;
  const notes = [
    ...(skipped.acked > 0 ? [`${was(skipped.acked)} schon quittiert`] : []),
    ...(gone > 0 ? [`${was(gone)} inzwischen behoben`] : []),
  ];
  const meanwhile = notes.length > 0 ? `${notes.join(', ')}.` : undefined;
  const denied = outcome.failed.filter((f) => ackFailure(f.error) === 'denied').length;
  const broken = outcome.failed.filter((f) => ackFailure(f.error) === 'error');

  if (broken.length > 0)
    return {
      tone: 'error',
      title: one ? 'Nicht quittiert' : `${broken.length} von ${total} nicht quittiert`,
      error: broken[0]!.error,
    };
  if (denied > 0)
    return {
      tone: 'warning',
      title: one ? 'Nicht quittiert' : `${denied} von ${total} nicht quittiert`,
      detail: denied === 1 ? 'Für dieses Gerät fehlt die Berechtigung.' : 'Für diese Geräte fehlt die Berechtigung.',
    };
  if (outcome.ok.length === 0) {
    if (single) return { tone: 'info', title: 'Alarm ist nicht mehr offen', detail: 'Er wurde inzwischen behoben.' };
    return {
      tone: 'info',
      title: 'Keiner der Alarme ist mehr offen',
      detail: skipped.acked > 0 ? meanwhile : 'Sie wurden inzwischen behoben.',
    };
  }
  return {
    tone: 'success',
    title: outcome.ok.length === 1 ? 'Alarm quittiert' : `${outcome.ok.length} Alarme quittiert`,
    detail: meanwhile ?? (single ? describe(outcome.ok[0]!) : undefined),
  };
}
