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
      'devices.token_created',
      'devices.token_deleted',
      'devices.updated',
      'devices.deleted',
      'device.wake',
      'device.maintenance',
      'device.agent_update',
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
    ];
    for (const name of events) {
      expect(describeAudit(event({ event: name, device_id: 1 }))).not.toBe(name);
    }
  });
});
