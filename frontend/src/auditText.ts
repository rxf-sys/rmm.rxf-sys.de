import type { AuditEvent } from './types';

/** Human summary of an audit row from its event type + detail blob.
 *
 * Lives outside AuditPage.tsx so that file exports components only (see
 * deviceStatus.ts for the same reason); the overview's activity feed
 * reuses the same phrasing. */
export function describeAudit(e: AuditEvent): string {
  const d = e.detail;
  switch (e.event) {
    case 'auth.login':
      return `Login von ${e.actor}${d.ip ? ` (${d.ip})` : ''}`;
    case 'agent.enrolled':
      return `Gerät enrollt: ${d.hostname ?? ''} (${d.os ?? ''})`;
    case 'job.created':
      return d.kind === 'script'
        ? `Skript „${d.script}" ausgeführt auf Gerät ${e.device_id}`
        : `Befehl auf Gerät ${e.device_id}: ${d.command ?? ''}`;
    case 'script.created':
      return `Skript angelegt: ${d.name ?? ''}`;
    case 'script.updated':
      return `Skript #${d.script_id} geändert`;
    case 'script.deleted':
      return `Skript #${d.script_id} gelöscht`;
    case 'devices.token_created':
      return `Enrollment-Token erzeugt${d.label ? ` (${d.label})` : ''}`;
    case 'devices.token_deleted':
      return 'Enrollment-Token widerrufen';
    case 'devices.updated':
      return `Gerät ${e.device_id} bearbeitet`;
    case 'devices.deleted':
      return `Gerät ${e.device_id} entfernt`;
    case 'patch.scan_requested':
      return `Patch-Scan auf Gerät ${e.device_id}`;
    case 'patch.install':
      return `Updates installiert auf Gerät ${e.device_id} (${d.count ?? '?'})`;
    case 'remote.session_opened':
      return `Remote-Sitzung auf Gerät ${e.device_id}`;
    case 'alert.fired':
      return `Alarm: ${d.message ?? d.rule ?? ''}`;
    default:
      return e.event;
  }
}

/** German name and badge tone per category. The classification itself is
 *  server-side (`app/audit.py`); this only decides how it looks.
 *
 *  The tones reuse the six badge classes the rest of the app already has
 *  rather than inventing a hue per category: those are defined for both
 *  themes and already contrast-checked, and twelve bespoke colours would say
 *  less than the grouping does. */
export const AUDIT_CATEGORY: Record<string, { label: string; tone: string }> = {
  auth: { label: 'Anmeldung', tone: 'badge-violet' },
  account: { label: 'Konten', tone: 'badge-violet' },
  credential: { label: 'Passwörter', tone: 'badge-danger' },
  remote: { label: 'Fernzugriff', tone: 'badge-danger' },
  device: { label: 'Geräte', tone: 'badge-accent' },
  job: { label: 'Jobs', tone: 'badge-accent' },
  script: { label: 'Skripte', tone: 'badge-accent' },
  patch: { label: 'Patches', tone: 'badge-warn' },
  alert: { label: 'Alarme', tone: 'badge-warn' },
  person: { label: 'Personen', tone: 'badge-ok' },
  config: { label: 'Konfiguration', tone: 'badge-off' },
  other: { label: 'Sonstiges', tone: 'badge-off' },
};

export function auditCategoryLabel(category: string): string {
  return AUDIT_CATEGORY[category]?.label ?? category;
}

/** Day header for the separators: "Heute", "Gestern", or the date. */
export function auditDayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
