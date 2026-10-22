import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_CATEGORY,
  auditCategoryLabel,
  auditDayLabel,
  auditNamesFrom,
  describeAudit,
} from '../auditText';
import type { AuditEvent } from '../types';

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  ts: at('2026-09-10T08:00:00'),
  event: 'auth.login',
  actor: 'robin',
  device_id: null,
  detail: {},
  category: 'auth',
  security: true,
  ...over,
});

describe('auditDayLabel', () => {
  afterEach(() => vi.useRealTimers());

  it('names today and yesterday instead of repeating the date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T14:00:00'));
    expect(auditDayLabel(at('2026-09-10T00:05:00'))).toBe('Heute');
    expect(auditDayLabel(at('2026-09-09T23:55:00'))).toBe('Gestern');
    expect(auditDayLabel(at('2026-09-08T12:00:00'))).toBe('08.09.2026');
  });

  it('compares calendar days, not 24-hour windows', () => {
    vi.useFakeTimers();
    // Five past midnight: an event from 23:55 is yesterday, ten minutes ago.
    vi.setSystemTime(new Date('2026-09-10T00:05:00'));
    expect(auditDayLabel(at('2026-09-09T23:55:00'))).toBe('Gestern');
  });
});

describe('audit categories', () => {
  it('covers every category the server can send', () => {
    // Mirrors app/audit.py CATEGORIES — a new one there without a label here
    // would render as a raw identifier.
    const fromServer = [
      'auth',
      'account',
      'device',
      'job',
      'patch',
      'remote',
      'alert',
      'script',
      'person',
      'credential',
      'config',
      'other',
    ];
    for (const c of fromServer) expect(AUDIT_CATEGORY[c]).toBeDefined();
  });

  it('falls back to the raw name for something unknown', () => {
    expect(auditCategoryLabel('brandneu')).toBe('brandneu');
  });
});

describe('describeAudit', () => {
  it('reads as a sentence, not as an event name', () => {
    expect(describeAudit(event({ detail: { ip: '10.0.0.5' } }))).toBe('Login von robin (10.0.0.5)');
    expect(
      describeAudit(
        event({ event: 'job.created', device_id: 4, detail: { kind: 'shell', command: 'whoami' } }),
      ),
    ).toBe('Befehl auf Gerät 4: whoami');
  });

  it('falls back to the event name for something it does not know', () => {
    expect(describeAudit(event({ event: 'brandneu.passiert' }))).toBe('brandneu.passiert');
  });

  it('prefers the name the server stored with the event', () => {
    const e = event({
      event: 'devices.deleted',
      device_id: 4,
      detail: { hostname: 'nas-fritz' },
    });
    // Even with a live list that disagrees: the stored name is what was true
    // at the time, and after a delete it is the only name left.
    const names = auditNamesFrom([{ id: 4, hostname: 'irgendwas-anderes' }]);
    expect(describeAudit(e, names)).toBe('nas-fritz entfernt');
  });

  it('resolves an id from the live list when the row carries no name', () => {
    const e = event({ event: 'devices.updated', device_id: 4, detail: {} });
    expect(describeAudit(e, auditNamesFrom([{ id: 4, hostname: 'buero-pc' }]))).toBe(
      'buero-pc bearbeitet',
    );
  });

  it('shows the id when nothing can resolve it', () => {
    const e = event({ event: 'devices.updated', device_id: 4, detail: {} });
    expect(describeAudit(e)).toBe('Gerät 4 bearbeitet');
    expect(describeAudit(e, auditNamesFrom([{ id: 9, hostname: 'anderes' }]))).toBe(
      'Gerät 4 bearbeitet',
    );
  });

  it('names the script in the same three steps', () => {
    const stored = event({ event: 'script.deleted', detail: { script_id: 7, script: 'Cleanup' } });
    expect(describeAudit(stored)).toBe('Skript „Cleanup“ gelöscht');

    const bare = event({ event: 'script.updated', detail: { script_id: 7 } });
    expect(describeAudit(bare, auditNamesFrom([], [{ id: 7, name: 'Drucker-Reset' }]))).toBe(
      'Skript „Drucker-Reset“ geändert',
    );
    expect(describeAudit(bare)).toBe('Skript „Skript #7“ geändert');
  });

  it('mentions a rename with the old name, and only when the name changed', () => {
    const renamed = event({
      event: 'script.updated',
      detail: { script_id: 7, script: 'Drucker-Reset', script_from: 'Drucker' },
    });
    expect(describeAudit(renamed)).toBe(
      'Skript „Drucker-Reset“ geändert, umbenannt von „Drucker“',
    );
    const edited = event({
      event: 'script.updated',
      detail: { script_id: 7, script: 'Drucker-Reset' },
    });
    expect(describeAudit(edited)).toBe('Skript „Drucker-Reset“ geändert');
  });

  it('says that the automatic update offer came from the server, with both versions', () => {
    const offer = event({
      event: 'agent.update_offered',
      actor: 'automation',
      device_id: 4,
      detail: { hostname: 'oma-pc', version: '1.9.0', from_version: '1.8.2' },
    });
    expect(describeAudit(offer)).toBe(
      'Agent-Update auf 1.9.0 automatisch an oma-pc angeboten (bisher 1.8.2)',
    );
    // An agent that reported no version leaves out the "bisher" part rather
    // than printing an empty one.
    expect(describeAudit({ ...offer, detail: { version: '1.9.0' } })).toBe(
      'Agent-Update auf 1.9.0 automatisch an Gerät 4 angeboten',
    );
  });

  it('names the device whose agent logs were fetched', () => {
    const e = event({ event: 'device.agent_logs', actor: 'techie', device_id: 4, detail: {} });
    expect(describeAudit(e, auditNamesFrom([{ id: 4, hostname: 'buero-pc' }]))).toBe(
      'Agent-Logs von buero-pc abgerufen',
    );
  });

  it('names the reporting device and the job it had no business with', () => {
    const foreign = event({
      event: 'agent.job_mismatch',
      device_id: 2,
      detail: { hostname: 'intruder-pc', job_id: 12, reason: 'foreign', owner_device_id: 1 },
    });
    expect(describeAudit(foreign)).toBe('Meldung von intruder-pc zu fremdem Job #12 abgewiesen');
    const unknown = event({
      event: 'agent.job_mismatch',
      device_id: 2,
      detail: { job_id: 99, reason: 'unknown' },
    });
    expect(describeAudit(unknown)).toBe('Meldung von Gerät 2 zu unbekanntem Job #99 abgewiesen');
  });

  it('has a sentence for every event the server can write', () => {
    // Sonst steht im Feed der rohe Ereignisname — genau das, was hier weg soll.
    const events = [
      'auth.login',
      'auth.backup_code_used',
      'auth.totp_enabled',
      'auth.totp_disabled',
      'auth.session_revoked',
      'auth.sessions_revoked_others',
      'account.created',
      'account.updated',
      'account.deleted',
      'account.password_reset',
      'account.totp_reset',
      'agent.enrolled',
      'agent.job_mismatch',
      'devices.token_created',
      'devices.token_deleted',
      'devices.updated',
      'devices.deleted',
      'device.wake',
      'device.maintenance',
      'device.agent_update',
      'agent.update_offered',
      'device.agent_logs',
      'job.created',
      'script.created',
      'script.updated',
      'script.deleted',
      'script.scheduled_run',
      'patch.scan_requested',
      'patch.install',
      'patch.window_install',
      'remote.session_opened',
      'credential.created',
      'credential.updated',
      'credential.revealed',
      'credential.deleted',
      'credential.stored_from_job',
      'alert.fired',
      'alert.acked',
      'person.created',
      'person.updated',
      'person.deleted',
      'settings.ntfy_updated',
      'automation.updated',
      'automation.rule_created',
      'automation.rule_updated',
      'automation.rule_deleted',
      'automation.schedule_created',
      'automation.schedule_updated',
      'automation.schedule_deleted',
      'mdm.enrollment_created',
      'mdm.enrollment_revoked',
      'mdm.profile_downloaded',
      'mdm.scep_rejected',
      'mdm.enrolled',
      'mdm.checked_out',
      'mdm.refresh_requested',
      'mdm.refresh_failed',
      'mdm.command_queued',
      'mdm.command_failed',
      'mdm.command_result',
      'mdm.device_lock',
      'mdm.device_erase',
      'mdm.passcode_cleared',
      'mdm.permissions_updated',
      'mdm.renewal_started',
      'mdm.renewal_done',
      'mdm.renewal_failed',
      'mdm.config_created',
      'mdm.config_updated',
      'mdm.config_deleted',
      'mdm.profile_install',
      'mdm.profile_remove',
      'mdm.app_install',
      'mdm.os_update_set',
      'mdm.os_update_cleared',
    ];
    for (const name of events) {
      expect(describeAudit(event({ event: name, device_id: 1 }))).not.toBe(name);
    }
  });
});

describe('describeAudit: queued actions', () => {
  const d = (name: string, detail: Record<string, unknown>) =>
    describeAudit(event({ event: name, device_id: 4, detail: { hostname: 'laptop', ...detail } }));

  it('says what was queued, started and how it ended', () => {
    expect(d('action.queued', { kind: 'patch_install', security_only: true })).toBe('Sicherheitsupdates auf laptop vorgemerkt');
    expect(d('action.queued', { kind: 'patch_install', source: 'patch_window' })).toBe(
      'Updates auf laptop vorgemerkt (Patch-Fenster, nachgeholt)',
    );
    expect(d('action.dispatched', { kind: 'patch_install', count: 3 })).toBe('Updates auf laptop gestartet (3)');
    expect(d('action.dispatched', { kind: 'script', script: 'Uptime' })).toBe('Skript „Uptime“ auf laptop gestartet');
    expect(d('action.dispatched', { kind: 'reboot' })).toBe('Neustart auf laptop gestartet');
    expect(d('action.done', { note: 'Kein Neustart nötig' })).toBe('Vormerkung auf laptop erledigt: Kein Neustart nötig');
    expect(d('action.expired', {})).toBe('Vormerkung auf laptop abgelaufen — das Gerät war nicht online');
    expect(d('action.cancelled', {})).toBe('Vormerkung auf laptop zurückgezogen');
  });
});

describe('describeAudit: MDM', () => {
  const at = (name: string, detail: Record<string, unknown> = {}) =>
    describeAudit(event({ event: name, device_id: 3, detail: { hostname: 'iPhone Oma', ...detail } }));

  it('names command results and permission changes in plain words', () => {
    expect(at('mdm.command_result', { request_type: 'DeviceLock', status: 'acknowledged' })).toBe(
      'Sperren auf iPhone Oma ausgeführt',
    );
    expect(at('mdm.command_result', { request_type: 'EraseDevice', status: 'error', error: 'Nicht erlaubt' })).toBe(
      'Löschen auf iPhone Oma fehlgeschlagen: Nicht erlaubt',
    );
    expect(at('mdm.permissions_updated', { denied: ['erase', 'apps'] })).toBe(
      'MDM-Befugnisse von iPhone Oma geändert — aus: Löschen, App-Liste',
    );
    expect(at('mdm.permissions_updated', { denied: [] })).toBe('MDM-Befugnisse von iPhone Oma geändert — alles erlaubt');
  });
});
