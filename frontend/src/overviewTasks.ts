/**
 * What the overview page should actually say: the list of things worth doing.
 *
 * The old overview restated numbers the sidebar already showed and left the
 * reader to work out what to do with them. This turns the same data into
 * sentences with a destination — and it lives outside the component so the
 * rules can be tested without rendering anything.
 *
 * Rules of the house:
 *  - One finding, one task. A disk at 91 % is not also an "alert" task;
 *    otherwise the same problem is counted twice and the list stops being a
 *    list of problems.
 *  - Never invent urgency. A task only exists when its condition is true
 *    right now; an empty list is a valid and good answer.
 */

import type { PageId } from './components/Sidebar';
import { hasProblem } from './deviceStatus';
import type { Device, PatchSummary } from './types';

export type TaskSeverity = 'crit' | 'warn' | 'info';

/** Where the task's button goes. */
export type TaskTarget =
  | { kind: 'device'; id: number }
  | { kind: 'page'; page: PageId; query?: string };

export interface OverviewTask {
  id: string;
  severity: TaskSeverity;
  /** Short uppercase tag on the left ("kritisch", "offline", …). */
  tag: string;
  title: string;
  /** Why this matters, or what happens next if nobody acts. */
  why: string;
  target: TaskTarget;
  actionLabel: string;
}

/** A device counts as neglected after this long without a scan report. */
const SCAN_STALE_DAYS = 3;
const DAY = 86_400;

const SEVERITY_ORDER: Record<TaskSeverity, number> = { crit: 0, warn: 1, info: 2 };

function maxDisk(d: Device): number {
  return Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
}

function names(devices: Device[], limit = 3): string {
  const shown = devices.slice(0, limit).map((d) => d.hostname);
  const rest = devices.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} und ${rest} weitere` : shown.join(', ');
}

function relativeDays(ts: number, now: number): number {
  return Math.floor((now - ts) / DAY);
}

export interface TaskInput {
  devices: Device[];
  patchSummary: PatchSummary;
  /** Seconds since the epoch; injected so the rules are testable. */
  now: number;
}

/**
 * The to-do list, most urgent first. Capped by the caller, not here — the
 * count in the heading should be honest about how many there are.
 */
export function buildTasks({ devices, patchSummary, now }: TaskInput): OverviewTask[] {
  const tasks: OverviewTask[] = [];
  const online = devices.filter((d) => d.online);

  // --- Platten, kritisch: das Einzige, was ohne Zutun kaputtgeht ----------
  for (const d of online.filter((x) => maxDisk(x) >= 90)) {
    tasks.push({
      id: `disk-crit-${d.id}`,
      severity: 'crit',
      tag: 'kritisch',
      title: `${d.hostname}: Platte zu ${Math.round(maxDisk(d))} % voll`,
      why: 'Ab hier scheitern Updates und Dienste schreiben ins Leere.',
      target: { kind: 'device', id: d.id },
      actionLabel: 'Gerät öffnen →',
    });
  }

  // --- Sicherheitsupdates -------------------------------------------------
  const securityDevices = devices.filter((d) => (patchSummary[String(d.id)]?.security ?? 0) > 0);
  const securityCount = securityDevices.reduce(
    (a, d) => a + (patchSummary[String(d.id)]?.security ?? 0),
    0,
  );
  if (securityCount > 0) {
    tasks.push({
      id: 'patches-security',
      severity: 'crit',
      tag: 'sicherheit',
      title: `${securityCount} Sicherheitsupdate${securityCount === 1 ? '' : 's'} auf ${securityDevices.length} Gerät${securityDevices.length === 1 ? '' : 'en'} offen`,
      why: names(securityDevices),
      target: { kind: 'page', page: 'patches' },
      actionLabel: 'Patches →',
    });
  }

  // --- Offline ------------------------------------------------------------
  const offline = devices
    .filter((d) => !d.online && d.last_seen_at !== null)
    .sort((a, b) => (a.last_seen_at ?? 0) - (b.last_seen_at ?? 0));
  const longGone = offline.filter((d) => now - (d.last_seen_at ?? now) >= DAY);
  const lonely = longGone.length === 1 ? longGone[0] : undefined;
  if (lonely) {
    const d = lonely;
    tasks.push({
      id: `offline-${d.id}`,
      severity: 'warn',
      tag: 'offline',
      title: `${d.hostname} seit ${relativeDays(d.last_seen_at ?? now, now)} Tagen nicht erreichbar`,
      why: 'Kein Heartbeat — weder Monitoring noch Updates laufen dort.',
      target: { kind: 'device', id: d.id },
      actionLabel: 'Gerät öffnen →',
    });
  } else if (longGone.length > 1) {
    tasks.push({
      id: 'offline-many',
      severity: 'warn',
      tag: 'offline',
      title: `${longGone.length} Geräte seit über einem Tag nicht erreichbar`,
      why: names(longGone),
      target: { kind: 'page', page: 'devices', query: 'filter=offline' },
      actionLabel: 'Geräte →',
    });
  }

  // --- Platten, Warnung ---------------------------------------------------
  const diskWarn = online.filter((d) => maxDisk(d) >= 80 && maxDisk(d) < 90);
  const oneDisk = diskWarn.length === 1 ? diskWarn[0] : undefined;
  if (diskWarn.length > 0) {
    tasks.push({
      id: 'disk-warn',
      severity: 'warn',
      tag: 'platte',
      title:
        oneDisk
          ? `${oneDisk.hostname}: Platte zu ${Math.round(maxDisk(oneDisk))} % voll`
          : `${diskWarn.length} Geräte über 80 % Plattenbelegung`,
      why: names(diskWarn),
      target: oneDisk
        ? { kind: 'device', id: oneDisk.id }
        : { kind: 'page', page: 'devices', query: 'filter=probleme' },
      actionLabel: oneDisk ? 'Gerät öffnen →' : 'Geräte →',
    });
  }

  // --- Update-Scan überfällig --------------------------------------------
  // Nur erreichbare Geräte: bei einem offline-Gerät ist der fehlende Scan
  // eine Folge, kein eigener Befund — der tägliche Scan holt ihn ohnehin
  // beim nächsten Heartbeat nach.
  const staleScan = online.filter(
    (d) => d.last_patch_scan_at === 0 || now - d.last_patch_scan_at >= SCAN_STALE_DAYS * DAY,
  );
  const oneStale = staleScan.length === 1 ? staleScan[0] : undefined;
  if (staleScan.length > 0) {
    tasks.push({
      id: 'scan-stale',
      severity: 'warn',
      tag: 'scan',
      title:
        oneStale
          ? `${oneStale.hostname}: kein aktueller Update-Scan`
          : `${staleScan.length} Geräte ohne aktuellen Update-Scan`,
      why: 'Der Patch-Stand dieser Geräte ist älter als drei Tage — was dort offen ist, weiß gerade niemand.',
      target: oneStale ? { kind: 'device', id: oneStale.id } : { kind: 'page', page: 'patches' },
      actionLabel: oneStale ? 'Gerät öffnen →' : 'Patches →',
    });
  }

  // --- Agent-Updates ------------------------------------------------------
  const outdated = devices.filter((d) => d.agent_update_available !== null);
  if (outdated.length > 0) {
    const target = outdated[0]?.agent_update_available ?? 'eine neuere Version';
    tasks.push({
      id: 'agent-update',
      severity: 'info',
      tag: 'agent',
      title: `${outdated.length} Gerät${outdated.length === 1 ? ' läuft' : 'e laufen'} auf einem älteren Agent`,
      why: `Aktuell ist ${target}. Das Update ist signiert und wird beim nächsten Kontakt angeboten.`,
      target: { kind: 'page', page: 'devices' },
      actionLabel: 'Geräte →',
    });
  }

  // --- Sonstige Updates ---------------------------------------------------
  const pending = Object.values(patchSummary).reduce((a, s) => a + s.pending, 0);
  const pendingOther = pending - securityCount;
  if (pendingOther > 0) {
    tasks.push({
      id: 'patches-pending',
      severity: 'info',
      tag: 'updates',
      title: `${pendingOther} weitere Updates verfügbar`,
      why: 'Ohne Sicherheitsbezug — sammeln lassen und im Patch-Fenster mitnehmen.',
      target: { kind: 'page', page: 'patches' },
      actionLabel: 'Patches →',
    });
  }

  return tasks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** One line of plain language about the fleet, shown under the greeting. */
export function verdict(devices: Device[], tasks: OverviewTask[]): { text: string; severity: TaskSeverity | 'ok' } {
  if (devices.length === 0) {
    return { text: 'Noch kein Gerät angebunden.', severity: 'info' };
  }
  const crit = tasks.filter((t) => t.severity === 'crit').length;
  const warn = tasks.filter((t) => t.severity === 'warn').length;
  if (crit > 0) {
    return {
      text:
        crit === 1
          ? '1 Punkt braucht heute Aufmerksamkeit.'
          : `${crit} Punkte brauchen heute Aufmerksamkeit.`,
      severity: 'crit',
    };
  }
  if (warn > 0) {
    return {
      text: warn === 1 ? '1 Punkt sollte diese Woche weg.' : `${warn} Punkte sollten diese Woche weg.`,
      severity: 'warn',
    };
  }
  const problems = devices.filter(hasProblem).length;
  return problems === 0
    ? { text: 'Nichts Dringendes — die Flotte läuft.', severity: 'ok' }
    : { text: 'Keine dringenden Punkte.', severity: 'ok' };
}
