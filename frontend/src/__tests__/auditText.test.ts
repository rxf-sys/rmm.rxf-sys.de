import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_CATEGORY, auditCategoryLabel, auditDayLabel, describeAudit } from '../auditText';
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
});
