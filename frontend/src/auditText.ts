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

/** MDM commands and permissions in the words of the device page. */
const MDM_REQUEST: Record<string, string> = {
  DeviceLock: 'Sperren',
  EraseDevice: 'Löschen',
  ClearPasscode: 'Code entfernen',
  InstallProfile: 'Zertifikatserneuerung',
  DeviceInformation: 'Inventar-Abfrage',
  SecurityInfo: 'Sicherheitsabfrage',
  ProfileList: 'Profil-Abfrage',
  CertificateList: 'Zertifikats-Abfrage',
  InstalledApplicationList: 'App-Abfrage',
};
const MDM_PERMISSION_WORD: Record<string, string> = {
  lock: 'Sperren',
  erase: 'Löschen',
  clear_passcode: 'Code entfernen',
  apps: 'App-Liste',
};

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
    case 'agent.job_mismatch': {
      // Das meldende Gerät steht in device_id; der Job gehört (falls es ihn
      // gibt) einem anderen — deshalb die Job-Nummer statt eines Namens.
      const id = num(d.job_id);
      const job = id === undefined ? 'Job' : `Job #${id}`;
      const which = d.reason === 'unknown' ? 'unbekanntem' : 'fremdem';
      return `Meldung von ${device()} zu ${which} ${job} abgewiesen`;
    }
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
    case 'agent.update_offered': {
      // Kein Klick dahinter: der Server bietet das Update beim ersten
      // Heartbeat einer Verbindung von selbst an (Akteur "automation").
      const to = str(d.version);
      const from = str(d.from_version);
      return `Agent-Update${to ? ` auf ${to}` : ''} automatisch an ${device()} angeboten${from ? ` (bisher ${from})` : ''}`;
    }
    case 'device.agent_logs':
      return `Agent-Logs von ${device()} abgerufen`;

    // --- Apple MDM ---
    case 'mdm.enrollment_created':
      return `MDM-Registrierungslink für ${device()} erzeugt`;
    case 'mdm.enrollment_revoked':
      return `MDM-Registrierungslink für ${device()} widerrufen`;
    case 'mdm.profile_downloaded':
      return `MDM-Profil für ${device()} geladen${d.ip ? ` (${d.ip})` : ''}`;
    case 'mdm.scep_rejected':
      return `Zertifikatsanfrage${e.device_id !== null ? ` für ${device()}` : ''} abgewiesen`;
    case 'mdm.enrolled':
      return `${device()} per MDM registriert`;
    case 'mdm.checked_out':
      return `MDM-Profil auf ${device()} entfernt`;
    case 'mdm.refresh_requested':
      return `Inventar von ${device()} abgefragt`;
    case 'mdm.refresh_failed':
    case 'mdm.command_failed':
      return `MDM-Befehl an ${device()} nicht verschickt${str(d.error) ? `: ${str(d.error)}` : ''}`;
    case 'mdm.command_queued':
      return `MDM-Befehl an ${device()} verschickt`;
    case 'mdm.command_result': {
      const what = MDM_REQUEST[str(d.request_type) ?? ''] ?? str(d.request_type) ?? 'Befehl';
      return d.status === 'error'
        ? `${what} auf ${device()} fehlgeschlagen${str(d.error) ? `: ${str(d.error)}` : ''}`
        : `${what} auf ${device()} ausgeführt`;
    }
    case 'mdm.device_lock':
      return `${device()} per MDM gesperrt`;
    case 'mdm.device_erase':
      return `Löschbefehl an ${device()} geschickt`;
    case 'mdm.passcode_cleared':
      return `Gerätecode von ${device()} entfernt`;
    case 'mdm.permissions_updated': {
      const off = Array.isArray(d.denied) ? d.denied.filter((x): x is string => typeof x === 'string') : [];
      return off.length
        ? `MDM-Befugnisse von ${device()} geändert — aus: ${off.map((x) => MDM_PERMISSION_WORD[x] ?? x).join(', ')}`
        : `MDM-Befugnisse von ${device()} geändert — alles erlaubt`;
    }
    case 'mdm.renewal_started':
      return `MDM-Zertifikat von ${device()} wird erneuert`;
    case 'mdm.renewal_done':
      return `MDM-Zertifikat von ${device()} erneuert`;
    case 'mdm.renewal_failed':
      return `Erneuerung des MDM-Zertifikats von ${device()} fehlgeschlagen${str(d.error) ? `: ${str(d.error)}` : ''}`;

    // --- Jobs und Skripte ---
    case 'job.created':
      return d.kind === 'script'
        ? `Skript „${script()}“ auf ${device()} ausgeführt`
        : `Befehl auf ${device()}: ${str(d.command) ?? ''}`;
    case 'script.created':
      return `Skript angelegt: ${script()}`;
    case 'script.updated': {
      // Ältere Einträge zu diesem Skript tragen noch den alten Namen; ohne
      // ihn hier wäre die Verbindung zwischen beiden nicht zu sehen.
      const from = str(d.script_from);
      return `Skript „${script()}“ geändert${from ? `, umbenannt von „${from}“` : ''}`;
    }
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

    // --- Vorgemerkt fürs nächste Online-Gehen ---
    case 'action.queued':
    case 'action.dispatched':
    case 'action.done':
    case 'action.failed':
    case 'action.expired':
    case 'action.cancelled': {
      const kind = str(d.kind);
      const what =
        kind === 'script'
          ? `Skript „${script()}“`
          : kind === 'reboot'
            ? 'Neustart'
            : d.security_only === true
              ? 'Sicherheitsupdates'
              : 'Updates';
      const origin = d.source === 'patch_window' ? ' (Patch-Fenster, nachgeholt)' : '';
      switch (e.event) {
        case 'action.queued':
          return `${what} auf ${device()} vorgemerkt${origin}`;
        case 'action.dispatched':
          return `${what} auf ${device()} gestartet${num(d.count) !== undefined ? ` (${num(d.count)})` : ''}${origin}`;
        case 'action.done':
          return `Vormerkung auf ${device()} erledigt${str(d.note) ? `: ${str(d.note)}` : ''}`;
        case 'action.failed':
          return `Vormerkung auf ${device()} fehlgeschlagen${str(d.note) ? `: ${str(d.note)}` : ''}`;
        case 'action.expired':
          return `Vormerkung auf ${device()} abgelaufen — das Gerät war nicht online`;
        default:
          return `Vormerkung auf ${device()} zurückgezogen`;
      }
    }

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

/** German name per category. The classification itself is server-side
 *  (`app/audit.py`). Categories carry no colour: twelve hues would say less
 *  than the label does. */
export const AUDIT_CATEGORY: Record<string, { label: string }> = {
  auth: { label: 'Anmeldung' },
  account: { label: 'Konten' },
  credential: { label: 'Passwörter' },
  remote: { label: 'Fernzugriff' },
  device: { label: 'Geräte' },
  job: { label: 'Jobs' },
  script: { label: 'Skripte' },
  patch: { label: 'Patches' },
  alert: { label: 'Alarme' },
  person: { label: 'Personen' },
  config: { label: 'Konfiguration' },
  other: { label: 'Sonstiges' },
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
