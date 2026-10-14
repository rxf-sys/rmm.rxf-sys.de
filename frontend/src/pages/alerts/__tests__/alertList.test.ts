import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Alert, Device } from '../../../types';
import {
  ackFailure,
  ackReport,
  agoPhrase,
  alertBadge,
  countTabs,
  isLongStanding,
  isTab,
  listState,
  openFor,
  preview,
  sortAlerts,
  stillToAck,
  tabOf,
  urgency,
} from '../alertList';

const NOW = 1_760_000_000;
const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    device_id: 1,
    rule: 'offline',
    message: 'Gerät meldet sich nicht',
    fired_at: NOW - MIN,
    resolved_at: null,
    notified: true,
    acked_at: null,
    acked_by: '',
    ...over,
  };
}

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'nas',
    owner_label: '',
    os: 'linux',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: { cpu_pct: 5, mem_pct: 20, disks: [{ mount: '/', used_pct: 50, total_b: 1 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: NOW,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: 0,
    device_class: 'agent',
    ownership: '',
    model: '',
    serial: '',
    imei: '',
    notes: '',
    checked_at: null,
    ...over,
  };
}

const fullDisk = device({ heartbeat: { cpu_pct: 5, mem_pct: 20, disks: [{ mount: '/', used_pct: 95, total_b: 1 }] } });

describe('tabs', () => {
  it('puts an alert in exactly one tab', () => {
    expect(tabOf(alert())).toBe('offen');
    expect(tabOf(alert({ acked_at: NOW }))).toBe('quittiert');
    // History, whether anyone saw it or not.
    expect(tabOf(alert({ resolved_at: NOW }))).toBe('behoben');
    expect(tabOf(alert({ acked_at: NOW - 10, resolved_at: NOW }))).toBe('behoben');
  });

  it('counts every tab', () => {
    const list = [alert(), alert({ id: 2 }), alert({ id: 3, acked_at: NOW }), alert({ id: 4, resolved_at: NOW })];
    expect(countTabs(list)).toEqual({ offen: 2, quittiert: 1, behoben: 1 });
    expect(countTabs([])).toEqual({ offen: 0, quittiert: 0, behoben: 0 });
  });

  it('accepts only known tabs from the address', () => {
    expect(isTab('quittiert')).toBe(true);
    expect(isTab('alle')).toBe(false);
    expect(isTab(null)).toBe(false);
  });
});

describe('urgency', () => {
  // The intent of the old page's severity rules: how long a condition has
  // lasted decides whether it is a blip or a state.
  it('treats a fresh outage as a notice, not as a catastrophe', () => {
    expect(isLongStanding(alert({ fired_at: NOW - 5 * MIN }), NOW)).toBe(false);
    expect(urgency(alert({ fired_at: NOW - 5 * MIN }), device(), NOW)).toBe(2);
  });

  it('moves an outage up once the device has been gone for a day', () => {
    expect(urgency(alert({ fired_at: NOW - 30 * HOUR }), device(), NOW)).toBe(1);
  });

  it('counts an overdue security patch as long-standing from the start', () => {
    // The rule fires only after its own grace period (30 days by default).
    expect(urgency(alert({ rule: 'patch_age' }), device(), NOW)).toBe(1);
  });

  it('leaves a rule it does not know at the bottom', () => {
    expect(urgency(alert({ rule: 'brandneu', fired_at: NOW - 30 * DAY }), device(), NOW)).toBe(2);
  });

  it('ranks a disk alert on a device that is critical right now first', () => {
    expect(urgency(alert({ rule: 'disk' }), fullDisk, NOW)).toBe(0);
    expect(urgency(alert({ rule: 'disk' }), device(), NOW)).toBe(2);
  });
});

describe('sortAlerts', () => {
  const ctx = (devices: Device[]) => ({ deviceOf: (id: number) => devices.find((d) => d.id === id), now: NOW });

  it('runs open before acknowledged before resolved', () => {
    const list = [alert({ id: 1, resolved_at: NOW }), alert({ id: 2, acked_at: NOW }), alert({ id: 3 })];
    expect(sortAlerts(list, ctx([])).map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it('puts the most urgent first and the newest first among equals', () => {
    const nas = device({ id: 7, heartbeat: fullDisk.heartbeat });
    const list = [
      alert({ id: 1, fired_at: NOW - 10 * MIN }),
      alert({ id: 2, fired_at: NOW - 2 * MIN }),
      alert({ id: 3, fired_at: NOW - 2 * DAY }),
      alert({ id: 4, rule: 'disk', device_id: 7, fired_at: NOW - MIN }),
    ];
    expect(sortAlerts(list, ctx([nas])).map((a) => a.id)).toEqual([4, 3, 2, 1]);
  });

  it('runs resolved alerts by when they cleared', () => {
    const list = [
      alert({ id: 1, fired_at: NOW - DAY, resolved_at: NOW - HOUR }),
      alert({ id: 2, fired_at: NOW - 2 * DAY, resolved_at: NOW - MIN }),
    ];
    expect(sortAlerts(list, ctx([])).map((a) => a.id)).toEqual([2, 1]);
  });

  it('does not change the list it is given', () => {
    const list = [alert({ id: 1, fired_at: NOW - HOUR }), alert({ id: 2 })];
    sortAlerts(list, ctx([]));
    expect(list.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('alertBadge', () => {
  it('says what the device state says while the alert is open', () => {
    expect(alertBadge(alert(), device())).toEqual({ kind: 'off', label: 'Offline' });
    expect(alertBadge(alert({ rule: 'disk' }), fullDisk)).toEqual({ kind: 'danger', label: 'Kritisch' });
    expect(alertBadge(alert({ rule: 'patch_age' }), device())).toEqual({ kind: 'warn', label: 'Warnung' });
  });

  it('says "Behoben" once the alert is history, whatever the device does now', () => {
    expect(alertBadge(alert({ rule: 'disk', resolved_at: NOW }), fullDisk)).toEqual({ kind: 'ok', label: 'Behoben', plain: true });
  });
});

describe('time phrases', () => {
  it('says how long a resolved alert was open', () => {
    expect(openFor(alert({ fired_at: NOW - 20, resolved_at: NOW }))).toBe('1 Min.');
    expect(openFor(alert({ fired_at: NOW - 25 * MIN, resolved_at: NOW }))).toBe('25 Min.');
    expect(openFor(alert({ fired_at: NOW - 5 * HOUR, resolved_at: NOW }))).toBe('5 Std.');
    expect(openFor(alert({ fired_at: NOW - 3 * DAY, resolved_at: NOW }))).toBe('3 Tage');
    expect(openFor(alert())).toBe('');
  });

  it('turns a date into "am …" inside a sentence', () => {
    expect(agoPhrase(NOW - 3 * HOUR, NOW)).toBe('vor 3 h');
    expect(agoPhrase(NOW - 30 * DAY, NOW)).toMatch(/^am \d{2}\.\d{2}\.\d{4}$/);
  });
});

describe('preview', () => {
  it('names a few and counts the rest', () => {
    expect(preview([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual({ head: [1, 2, 3, 4, 5, 6], rest: 2 });
  });

  it('shows a single leftover instead of counting it', () => {
    expect(preview([1, 2, 3, 4, 5, 6, 7], 6)).toEqual({ head: [1, 2, 3, 4, 5, 6, 7], rest: 0 });
    expect(preview([1, 2], 6)).toEqual({ head: [1, 2], rest: 0 });
  });
});

describe('listState', () => {
  it('is ready as soon as there are alerts', () => {
    expect(listState(3, 0, undefined)).toBe('ready');
  });

  it('asks the cache whether an empty list is empty or not loaded', () => {
    expect(listState(0, 0, { status: 'pending', data: undefined })).toBe('loading');
    expect(listState(0, 0, { status: 'success', data: [] })).toBe('ready');
    expect(listState(0, 0, { status: 'error', data: undefined })).toBe('failed');
    // A failed refresh over an earlier answer still has something to show.
    expect(listState(0, 0, { status: 'error', data: [] })).toBe('ready');
  });

  it('without a cache entry, trusts a fleet that has devices', () => {
    expect(listState(0, 4, undefined)).toBe('ready');
    expect(listState(0, 0, undefined)).toBe('loading');
  });
});

describe('acknowledging', () => {
  const describeAlert = (a: Alert) => `nas: ${a.message}`;

  it('reads a 404 as "already gone" and a 403 as missing rights', () => {
    expect(ackFailure(new ApiError(404, ''))).toBe('gone');
    expect(ackFailure(new ApiError(403, ''))).toBe('denied');
    expect(ackFailure(new ApiError(500, ''))).toBe('error');
    expect(ackFailure(new TypeError('Failed to fetch'))).toBe('error');
  });

  it('names a single acknowledged alert', () => {
    const a = alert();
    expect(ackReport({ ok: [a], failed: [] }, describeAlert)).toEqual({
      tone: 'success',
      title: 'Alarm quittiert',
      detail: 'nas: Gerät meldet sich nicht',
    });
  });

  it('counts a round and mentions what cleared in the meantime', () => {
    const report = ackReport(
      { ok: [alert({ id: 1 }), alert({ id: 2 })], failed: [{ item: alert({ id: 3 }), error: new ApiError(404, '') }] },
      describeAlert,
    );
    expect(report).toEqual({ tone: 'success', title: '2 Alarme quittiert', detail: '1 war inzwischen behoben.' });
  });

  it('is calm when the alert cleared before the click arrived', () => {
    expect(ackReport({ ok: [], failed: [{ item: alert(), error: new ApiError(404, '') }] }, describeAlert)).toMatchObject({
      tone: 'info',
      title: 'Alarm ist nicht mehr offen',
    });
  });

  it('explains missing rights instead of showing the status', () => {
    expect(ackReport({ ok: [], failed: [{ item: alert(), error: new ApiError(403, '') }] }, describeAlert)).toEqual({
      tone: 'warning',
      title: 'Nicht quittiert',
      detail: 'Für dieses Gerät fehlt die Berechtigung.',
    });
  });

  it('reports a failure with the first error, and how many of the round failed', () => {
    const boom = new TypeError('Failed to fetch');
    const report = ackReport(
      {
        ok: [alert({ id: 1 })],
        failed: [
          { item: alert({ id: 2 }), error: boom },
          { item: alert({ id: 3 }), error: new ApiError(500, '') },
        ],
      },
      describeAlert,
    );
    expect(report).toEqual({ tone: 'error', title: '2 von 3 nicht quittiert', error: boom });
  });

  it('sends only what is still open and not already on its way', () => {
    const open = alert({ id: 1 });
    const running = alert({ id: 2 });
    const takenMeanwhile = alert({ id: 3 });
    const clearedMeanwhile = alert({ id: 4 });
    const vanished = alert({ id: 5 });
    const now = [open, running, { ...takenMeanwhile, acked_at: NOW, acked_by: 'ben' }, { ...clearedMeanwhile, resolved_at: NOW }];
    const { send, skipped } = stillToAck([open, running, takenMeanwhile, clearedMeanwhile, vanished], now, new Set([2]));
    expect(send.map((a) => a.id)).toEqual([1]);
    expect(skipped).toEqual({ acked: 2, resolved: 2 });
  });

  it('says what a round left out', () => {
    expect(ackReport({ ok: [alert({ id: 1 })], failed: [] }, describeAlert, { acked: 1, resolved: 0 })).toEqual({
      tone: 'success',
      title: 'Alarm quittiert',
      detail: '1 war schon quittiert.',
    });
    expect(
      ackReport({ ok: [alert({ id: 1 })], failed: [{ item: alert({ id: 2 }), error: new ApiError(404, '') }] }, describeAlert, {
        acked: 2,
        resolved: 1,
      }),
    ).toEqual({ tone: 'success', title: 'Alarm quittiert', detail: '2 waren schon quittiert, 2 waren inzwischen behoben.' });
    expect(ackReport({ ok: [], failed: [] }, describeAlert, { acked: 3, resolved: 0 })).toEqual({
      tone: 'info',
      title: 'Keiner der Alarme ist mehr offen',
      detail: '3 waren schon quittiert.',
    });
    // One request that failed is still "Nicht quittiert", not "1 von 1".
    expect(
      ackReport({ ok: [], failed: [{ item: alert(), error: new TypeError('x') }] }, describeAlert, { acked: 1, resolved: 0 }),
    ).toMatchObject({ tone: 'error', title: 'Nicht quittiert' });
  });
});
