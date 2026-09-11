import { describe, expect, it } from 'vitest';
import { buildTasks, verdict } from '../overviewTasks';
import type { Device, PatchSummary } from '../types';

const NOW = 1_800_000_000;
const DAY = 86_400;

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'pc-1',
    owner_label: '',
    os: 'linux',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.4.2',
    tags: [],
    heartbeat: { disks: [{ mount: '/', used_pct: 30, total_b: 100 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: NOW - 30,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: NOW - 3600,
    ...over,
  };
}

const build = (devices: Device[], patchSummary: PatchSummary = {}) =>
  buildTasks({ devices, patchSummary, now: NOW });

describe('buildTasks', () => {
  it('says nothing when there is nothing to say', () => {
    expect(build([device()])).toEqual([]);
  });

  it('puts a full disk first and names the device', () => {
    const tasks = build([
      device({ id: 2, hostname: 'nas-fritz', heartbeat: { disks: [{ mount: '/', used_pct: 91, total_b: 1 }] } }),
      device(),
    ]);
    expect(tasks[0]?.severity).toBe('crit');
    expect(tasks[0]?.title).toBe('nas-fritz: Platte zu 91 % voll');
    expect(tasks[0]?.target).toEqual({ kind: 'device', id: 2 });
  });

  it('counts security updates across the fleet', () => {
    const tasks = build([device({ id: 1 }), device({ id: 2, hostname: 'pc-2' })], {
      '1': { pending: 4, security: 2 },
      '2': { pending: 1, security: 1 },
    });
    const sec = tasks.find((t) => t.id === 'patches-security');
    expect(sec?.title).toBe('3 Sicherheitsupdates auf 2 Geräten offen');
    expect(sec?.severity).toBe('crit');
    // Der Rest taucht getrennt und ohne Doppelzählung auf: 5 - 3 = 2.
    expect(tasks.find((t) => t.id === 'patches-pending')?.title).toBe('2 weitere Updates verfügbar');
  });

  it('ignores a device that just went offline and reports a long absence', () => {
    const brief = build([device({ online: false, last_seen_at: NOW - 600 })]);
    expect(brief.find((t) => t.tag === 'offline')).toBeUndefined();

    const gone = build([
      device({ id: 3, hostname: 'notebook-oma', online: false, last_seen_at: NOW - 2 * DAY }),
    ]);
    const task = gone.find((t) => t.tag === 'offline');
    expect(task?.title).toBe('notebook-oma seit 2 Tagen nicht erreichbar');
    expect(task?.target).toEqual({ kind: 'device', id: 3 });
  });

  it('aggregates several absent devices into one row with a filter link', () => {
    const tasks = build([
      device({ id: 3, hostname: 'a', online: false, last_seen_at: NOW - 2 * DAY }),
      device({ id: 4, hostname: 'b', online: false, last_seen_at: NOW - 5 * DAY }),
    ]);
    const task = tasks.find((t) => t.tag === 'offline');
    expect(task?.title).toBe('2 Geräte seit über einem Tag nicht erreichbar');
    expect(task?.target).toEqual({ kind: 'page', page: 'devices', query: 'filter=offline' });
  });

  it('flags a stale update scan only for devices that can answer', () => {
    const online = build([device({ last_patch_scan_at: NOW - 5 * DAY })]);
    expect(online.find((t) => t.tag === 'scan')?.title).toBe('pc-1: kein aktueller Update-Scan');

    // Offline: der fehlende Scan ist eine Folge, kein eigener Befund.
    const offline = build([
      device({ online: false, last_seen_at: NOW - 5 * DAY, last_patch_scan_at: NOW - 5 * DAY }),
    ]);
    expect(offline.find((t) => t.tag === 'scan')).toBeUndefined();
  });

  it('never reports the same disk twice', () => {
    const tasks = build([
      device({ heartbeat: { disks: [{ mount: '/', used_pct: 95, total_b: 1 }] } }),
    ]);
    expect(tasks.filter((t) => t.tag === 'kritisch' || t.tag === 'platte')).toHaveLength(1);
  });

  it('sorts critical before warning before info', () => {
    const tasks = build(
      [
        device({ id: 1, heartbeat: { disks: [{ mount: '/', used_pct: 92, total_b: 1 }] } }),
        device({ id: 2, hostname: 'b', heartbeat: { disks: [{ mount: '/', used_pct: 85, total_b: 1 }] } }),
        device({ id: 3, hostname: 'c', agent_update_available: '1.5.0' }),
      ],
      { '1': { pending: 2, security: 0 } },
    );
    const order = tasks.map((t) => t.severity);
    expect(order).toEqual([...order].sort((a, b) => (a === b ? 0 : a === 'crit' ? -1 : b === 'crit' ? 1 : a === 'warn' ? -1 : 1)));
    expect(order[0]).toBe('crit');
  });
});

describe('verdict', () => {
  it('leads with the critical count when there is one', () => {
    const devices = [device({ heartbeat: { disks: [{ mount: '/', used_pct: 95, total_b: 1 }] } })];
    const v = verdict(devices, build(devices));
    expect(v.severity).toBe('crit');
    expect(v.text).toBe('1 Punkt braucht heute Aufmerksamkeit.');
  });

  it('is calm when nothing is open', () => {
    expect(verdict([device()], []).severity).toBe('ok');
  });

  it('says so when there is no fleet at all', () => {
    expect(verdict([], []).text).toBe('Noch kein Gerät angebunden.');
  });
});
