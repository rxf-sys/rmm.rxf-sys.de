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
