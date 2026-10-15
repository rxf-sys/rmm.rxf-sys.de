/**
 * One device's history as a single timeline: jobs, alerts (fired and
 * resolved) and — for admins — changes from the audit log. Each source alone
 * answers one question; together they answer "what happened to this machine
 * yesterday", which is the question someone has when it misbehaves.
 */
import { describeAudit } from '../../auditText';
import type { Alert, AuditEvent, Job } from '../../types';

export type TimelineKind = 'job' | 'alert' | 'change';

export type TimelineEntry =
  | { kind: 'job'; key: string; ts: number; job: Job }
  | { kind: 'alert'; key: string; ts: number; alert: Alert; resolved: boolean }
  | { kind: 'change'; key: string; ts: number; text: string; actor: string };

/** Audit events the timeline already shows in richer form. */
const COVERED = new Set(['job.created', 'patch.install', 'patch.window_install', 'script.scheduled_run', 'alert.fired']);

export function jobTitle(j: Job): string {
  if (j.kind === 'script') return `Skript: ${j.script_name}`;
  if (j.kind === 'patch_install') return 'Updates installiert';
  return j.command;
}

export function buildTimeline(jobs: Job[], alerts: Alert[], audit: AuditEvent[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const job of jobs) out.push({ kind: 'job', key: `j${job.id}`, ts: job.created_at, job });
  for (const alert of alerts) {
    out.push({ kind: 'alert', key: `a${alert.id}`, ts: alert.fired_at, alert, resolved: false });
    if (alert.resolved_at) out.push({ kind: 'alert', key: `r${alert.id}`, ts: alert.resolved_at, alert, resolved: true });
  }
  for (const e of audit) {
    if (COVERED.has(e.event)) continue;
    out.push({ kind: 'change', key: `c${e.id}`, ts: e.ts, text: describeAudit(e), actor: e.actor });
  }
  // Newest first; at the same second a resolution reads after its alert.
  return out.sort((a, b) => b.ts - a.ts || a.key.localeCompare(b.key));
}

/** Entries grouped by local day, in order. */
export function byDay(entries: TimelineEntry[], label: (ts: number) => string): { day: string; entries: TimelineEntry[] }[] {
  const groups: { day: string; entries: TimelineEntry[] }[] = [];
  for (const e of entries) {
    const day = label(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}
