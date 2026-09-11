import type { AuditEvent } from './types';

/**
 * Turns an id into a display name, for rows written before the server started
 * storing names alongside the id. Both lookups are optional: a screen that
 * has no script list simply falls back to the id.
 */
export interface AuditNames {
  device?: (id: number) => string | undefined;
  script?: (id: number) => string | undefined;
}

/**
 * Build the lookups from the lists a screen already has. Missing lists are
 * simply absent — the overview has no script list and falls back to the id
 * for the handful of old rows that carry no name.
 */
export function auditNamesFrom(
  devices?: readonly { id: number; hostname: string }[],
  scripts?: readonly { id: number; name: string }[],
): AuditNames {
  const byId = <T extends { id: number }>(
    rows: readonly T[] | undefined,
    pick: (r: T) => string,
  ) => {
    if (!rows?.length) return undefined;
    const map = new Map(rows.map((r) => [r.id, pick(r)]));
    return (id: number) => map.get(id);
  };
  return {
    device: byId(devices, (d) => d.hostname),
    script: byId(scripts, (s) => s.name),
  };
}

/** Human summary of an audit row from its event type + detail blob.
 *
 * Lives outside AuditPage.tsx so that file exports components only (see
 * deviceStatus.ts for the same reason); the overview's activity feed and the
 * person detail reuse the same phrasing.
 *
 * Names beat ids in three steps: the name stored with the event (the server
 * writes it since the device/script may be gone by the time anyone reads
 * this), then a lookup in the live list for older rows, then the bare id.
 * "Befehl auf Gerät 4" was technically accurate and useless.
 */
export function describeAudit(e: AuditEvent, names: AuditNames = {}): string {
  const d = e.detail;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

  const device = () => {
    const stored = str(d.hostname);
    if (stored) return stored;
    if (e.device_id === null) return 'einem Gerät';
    return names.device?.(e.device_id) ?? `Gerät ${e.device_id}`;
  };
  const label = () => {
    const l = str(d.label);
    if (l) return `„${l}“`;
    const id = num(d.cred_id);
    return id === undefined ? '' : `#${id}`;
  };
  const script = () => {
    const stored = str(d.script) ?? str(d.name);
    if (stored) return stored;
    const id = num(d.script_id);
    if (id === undefined) return 'ein Skript';
    return names.script?.(id) ?? `Skript #${id}`;
  };

  switch (e.event) {
    // --- Anmeldung und Konten ---
    case 'auth.login':
      return `Login von ${e.actor}${d.ip ? ` (${d.ip})` : ''}`;
    case 'auth.backup_code_used':
      return `${e.actor} hat sich mit einem Backup-Code angemeldet`;
    case 'auth.totp_enabled':
      return `${e.actor} hat die Zwei-Faktor-Anmeldung eingerichtet`;
    case 'auth.totp_disabled':
      return `${e.actor} hat die Zwei-Faktor-Anmeldung abgeschaltet`;
    case 'auth.session_revoked':
      return `${e.actor} hat eine Sitzung beendet`;
    case 'auth.sessions_revoked_others':
      return `${e.actor} hat alle anderen Sitzungen beendet`;
    case 'account.created':
      return `Konto angelegt: ${str(d.username) ?? ''}${d.role ? ` (${d.role})` : ''}`;
    case 'account.updated':
      return `Konto geändert: ${str(d.username) ?? ''}`;
    case 'account.deleted':
      return `Konto gelöscht: ${str(d.username) ?? ''}`;
    case 'account.password_reset':
      return `Passwort zurückgesetzt für ${str(d.username) ?? ''}`;
    case 'account.totp_reset':
      return `Zwei-Faktor zurückgesetzt für ${str(d.username) ?? ''}`;

    // --- Geräte ---
    case 'agent.enrolled':
      return `Gerät enrollt: ${str(d.hostname) ?? ''}${d.os ? ` (${d.os})` : ''}`;
    case 'devices.token_created':
      return `Enrollment-Token erzeugt${d.label ? ` (${d.label})` : ''}`;
    case 'devices.token_deleted':
      return 'Enrollment-Token widerrufen';
    case 'devices.updated':
      return `${device()} bearbeitet`;
    case 'devices.deleted':
      return `${device()} entfernt`;
    case 'device.wake':
      return `Magic Packet an ${device()} gesendet`;
    case 'device.maintenance':
      return num(d.minutes)
        ? `Wartungsfenster für ${device()} gesetzt — ${d.minutes} Minuten`
        : `Wartungsfenster für ${device()} beendet`;
    case 'device.agent_update':
      return `Agent-Update auf ${device()} angestoßen`;

    // --- Jobs und Skripte ---
    case 'job.created':
      return d.kind === 'script'
        ? `Skript „${script()}“ auf ${device()} ausgeführt`
        : `Befehl auf ${device()}: ${str(d.command) ?? ''}`;
    case 'script.created':
      return `Skript angelegt: ${script()}`;
    case 'script.updated':
      return `Skript „${script()}“ geändert`;
    case 'script.deleted':
      return `Skript „${script()}“ gelöscht`;
    case 'script.scheduled_run':
      return `Geplantes Skript „${script()}“ auf ${device()} gestartet`;

    // --- Patches ---
    case 'patch.scan_requested':
      return `Update-Scan auf ${device()}`;
    case 'patch.install':
      return `Updates installiert auf ${device()} (${num(d.count) ?? '?'})`;
    case 'patch.window_install':
      return `Patch-Fenster: ${num(d.count) ?? '?'} Updates auf ${device()} gestartet`;

    // --- Fernzugriff und Passwörter ---
    case 'remote.session_opened':
      return `Remote-Sitzung auf ${device()}`;
    case 'credential.created':
      return `Passwort ${label()} bei ${device()} hinterlegt`;
    case 'credential.updated':
      return `Passwort ${label()} bei ${device()} geändert`;
    case 'credential.revealed':
      // Aufdecken und Löschen speichern nur die cred_id — das Label bleibt
      // bewusst draußen, wo es niemand braucht.
      return `${e.actor} hat ein Passwort ${label()} bei ${device()} aufgedeckt`;
    case 'credential.deleted':
      return `Passwort ${label()} bei ${device()} gelöscht`;
    case 'credential.stored_from_job':
      return `Skript hat Passwort ${label()} bei ${device()} hinterlegt`;

    // --- Alarme, Personen, Konfiguration ---
    case 'alert.fired':
      return `Alarm: ${str(d.message) ?? str(d.rule) ?? ''}`;
    case 'alert.acked':
      return `Alarm auf ${device()} quittiert`;
    case 'person.created':
      return `Person angelegt: ${str(d.name) ?? ''}`;
    case 'person.updated':
      return `Person bearbeitet: ${str(d.name) ?? ''}`;
    case 'person.deleted':
      return 'Person gelöscht';
    case 'settings.ntfy_updated':
      return 'ntfy-Einstellungen geändert';
    case 'automation.updated':
      return 'Patch-Fenster geändert';
    case 'automation.rule_created':
      return 'Alarmregel angelegt';
    case 'automation.rule_updated':
      return 'Alarmregel geändert';
    case 'automation.rule_deleted':
      return 'Alarmregel gelöscht';
    case 'automation.schedule_created':
      return `Zeitplan für „${script()}“ angelegt`;
    case 'automation.schedule_updated':
      // Nur die sched_id im Detail — welches Skript dahintersteckt, weiß
      // dieses Ereignis nicht.
      return 'Zeitplan geändert';
    case 'automation.schedule_deleted':
      return 'Zeitplan gelöscht';
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
  const midnight = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
