import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../types';
import {
  DEFAULT_RANGE,
  csvDateTime,
  csvFileName,
  detailRows,
  deviceName,
  groupByDay,
  hasFilters,
  isNarrowed,
  readFilters,
  sinceFor,
  timeOfDay,
  toCsv,
} from '../auditLog';

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime() / 1000;

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1,
  ts: at(2026, 10, 9, 14, 2, 11),
  event: 'auth.login',
  actor: 'robin',
  device_id: null,
  detail: {},
  category: 'auth',
  security: true,
  ...over,
});

describe('readFilters', () => {
  it('opens on the last seven days with nothing else set', () => {
    expect(readFilters(new URLSearchParams())).toEqual({ range: '7d', security: false, category: '', actor: '' });
  });

  it('reads every filter from the address and ignores what it does not know', () => {
    expect(readFilters(new URLSearchParams('range=30d&category=job&actor=lisa'))).toEqual({
      range: '30d',
      security: false,
      category: 'job',
      actor: 'lisa',
    });
    const odd = readFilters(new URLSearchParams('range=1y&category=nope'));
    expect(odd.range).toBe(DEFAULT_RANGE);
    expect(odd.category).toBe('');
  });

  it('drops the category while "Nur Sicherheit" is on, as the server does', () => {
    const f = readFilters(new URLSearchParams('security=1&category=job'));
    expect(f.security).toBe(true);
    expect(f.category).toBe('');
  });
});

describe('hasFilters and isNarrowed', () => {
  const base = readFilters(new URLSearchParams());

  it('treats the time range as a view, not a filter', () => {
    const wide = { ...base, range: 'alle' as const };
    expect(hasFilters(wide, '')).toBe(false);
    expect(isNarrowed(wide, '')).toBe(true);
    expect(isNarrowed(base, '')).toBe(false);
  });

  it('counts search, actor, category and the security switch', () => {
    expect(hasFilters(base, 'ssh')).toBe(true);
    expect(hasFilters({ ...base, actor: 'robin' }, '')).toBe(true);
    expect(hasFilters({ ...base, category: 'job' }, '')).toBe(true);
    expect(hasFilters({ ...base, security: true }, '')).toBe(true);
  });
});

describe('sinceFor', () => {
  it('counts back from the given moment, and not at all for "Alles"', () => {
    expect(sinceFor('24h', 1_000_000)).toBe(1_000_000 - 86_400);
    expect(sinceFor('30d', 10_000_000)).toBe(10_000_000 - 30 * 86_400);
    expect(sinceFor('alle', 1_000_000)).toBeUndefined();
  });
});

describe('groupByDay', () => {
  it('groups consecutive events under one label and keeps their order', () => {
    const events = [
      event({ id: 3, ts: at(2026, 10, 9, 9) }),
      event({ id: 2, ts: at(2026, 10, 9, 8) }),
      event({ id: 1, ts: at(2026, 10, 8, 23) }),
    ];
    const groups = groupByDay(events, (ts) => new Date(ts * 1000).getDate().toString());
    expect(groups.map((g) => [g.day, g.events.map((e) => e.id)])).toEqual([
      ['9', [3, 2]],
      ['8', [1]],
    ]);
  });
});

describe('timeOfDay and csvDateTime', () => {
  it('read to the second', () => {
    expect(timeOfDay(at(2026, 10, 9, 7, 5, 3))).toBe('07:05:03');
    expect(csvDateTime(at(2026, 10, 9, 7, 5, 3))).toBe('09.10.2026 07:05:03');
  });
});

describe('deviceName', () => {
  const names = { device: (id: number) => (id === 4 ? 'nas' : undefined) };

  it('prefers the stored hostname, then the live fleet, then the id', () => {
    expect(deviceName(event({ device_id: 4, detail: { hostname: 'alter-name' } }), names)).toBe('alter-name');
    expect(deviceName(event({ device_id: 4 }), names)).toBe('nas');
    expect(deviceName(event({ device_id: 9 }), names)).toBe('Gerät 9');
    expect(deviceName(event(), names)).toBeNull();
  });
});

describe('detailRows', () => {
  it('names known fields in German and keeps the key for the rest', () => {
    const rows = detailRows(event({ detail: { command: 'shutdown /r', sched_id: 7, frobnicate: 'x' } }));
    expect(rows).toEqual([
      { key: 'command', label: 'Befehl', value: 'shutdown /r', code: true },
      { key: 'sched_id', label: 'Zeitplan-ID', value: '7', code: false },
      { key: 'frobnicate', label: null, value: 'x', code: false },
    ]);
  });

  it('writes yes/no, a dash for nothing, and JSON for structures', () => {
    const rows = detailRows(event({ detail: { auto: true, note: '', base: null, macs: ['aa:bb'] } }));
    expect(rows.map((r) => [r.value, r.code])).toEqual([
      ['ja', false],
      ['—', false],
      ['—', false],
      ['["aa:bb"]', true],
    ]);
  });
});

describe('toCsv', () => {
  it('starts with a byte-order mark and a German header', () => {
    const csv = toCsv([event()], {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header).toBe('Zeitpunkt;Akteur;Kategorie;Ereignis;Beschreibung;Gerät;Geräte-ID;Sicherheitsrelevant;Details');
    expect(row).toBe('09.10.2026 14:02:11;robin;Anmeldung;auth.login;Login von robin;;;ja;');
  });

  it('defuses cells a spreadsheet would run as a formula', () => {
    const csv = toCsv(
      [event({ event: 'job.created', category: 'job', security: false, device_id: 3, detail: { hostname: '=HYPERLINK("x")', command: '-rf' } })],
      {},
    );
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).not.toMatch(/;=/);
    // The detail blob is JSON with quotes and goes along quoted.
    expect(row).toContain('"{""hostname"":""=HYPERLINK(\\""x\\"")"",""command"":""-rf""}"');
  });

  it('quotes values with semicolons and names the device by its live name', () => {
    const csv = toCsv([event({ event: 'devices.updated', category: 'device', device_id: 4, detail: { note: 'a;b' } })], {
      device: () => 'nas',
    });
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain(';nas;4;ja;');
    expect(row).toContain('"{""note"":""a;b""}"');
  });
});

describe('csvFileName', () => {
  it('carries the date, and the page when it is not the first', () => {
    const day = new Date(2026, 9, 9);
    expect(csvFileName(1, day)).toBe('vulpexa-audit-2026-10-09.csv');
    expect(csvFileName(3, day)).toBe('vulpexa-audit-2026-10-09-seite-3.csv');
  });
});
