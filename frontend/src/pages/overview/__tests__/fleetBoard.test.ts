import { describe, expect, it } from 'vitest';
import type { Alert, Device } from '../../../types';
import { buildTiles, countByKind, filterTiles, tileOf } from '../fleetBoard';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'pc',
    owner_label: '',
    os: 'linux',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.0.0',
    tags: [],
    heartbeat: { cpu_pct: 10, mem_pct: 20, disks: [{ mount: '/', used_pct: 30, total_b: 1 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: 1,
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

const alert = (deviceId: number, resolved: number | null = null): Alert => ({
  id: deviceId * 10,
  device_id: deviceId,
  rule: 'disk',
  message: '',
  fired_at: 0,
  resolved_at: resolved,
  notified: false,
  acked_at: null,
  acked_by: '',
});

describe('fleetBoard', () => {
  it('puts problems first, the worst of a state leading it', () => {
    const tiles = buildTiles(
      [
        device({ id: 1, hostname: 'b-ok' }),
        device({ id: 2, hostname: 'a-ok' }),
        device({ id: 3, hostname: 'voll', heartbeat: { disks: [{ mount: '/', used_pct: 95, total_b: 1 }] } }),
        device({ id: 4, hostname: 'weg', online: false }),
        device({ id: 5, hostname: 'handy', device_class: 'mobile', os: 'ios' }),
        device({ id: 6, hostname: 'z-ok-mit-sicherheit' }),
      ],
      { '6': { pending: 2, security: 1 } },
      [],
    );
    expect(tiles.map((t) => t.device.hostname)).toEqual(['voll', 'weg', 'z-ok-mit-sicherheit', 'a-ok', 'b-ok', 'handy']);
  });

  it('shows load only for a device that reports now, with the fullest disk', () => {
    const t = tileOf(
      device({ heartbeat: { cpu_pct: 91.6, mem_pct: 50, disks: [{ mount: '/', used_pct: 40, total_b: 1 }, { mount: '/data', used_pct: 85, total_b: 1 }] } }),
      {},
      [],
    );
    expect(t.load.map((r) => [r.label, r.pct, r.level, r.detail])).toEqual([
      ['CPU', 92, 'crit', undefined],
      ['RAM', 50, 'ok', undefined],
      ['Platte', 85, 'warn', '/data'],
    ]);
    expect(tileOf(device({ online: false }), {}, []).load).toEqual([]);
    expect(tileOf(device({ device_class: 'mobile', os: 'ios' }), {}, []).load).toEqual([]);
  });

  it('counts open alerts, reboot and never-scanned per device', () => {
    const t = tileOf(device({ id: 7, last_patch_scan_at: 0, heartbeat: { reboot_required: true } }), {}, [alert(7), alert(7, 5), alert(8)]);
    expect(t.openAlerts).toBe(1);
    expect(t.rebootRequired).toBe(true);
    expect(t.neverScanned).toBe(true);
  });

  it('filters by state and person, counting per state', () => {
    const tiles = buildTiles(
      [device({ id: 1, person_id: 4 }), device({ id: 2, online: false, person_id: 4 }), device({ id: 3, online: false })],
      {},
      [],
    );
    expect(countByKind(tiles)).toEqual({ danger: 0, warn: 0, off: 2, ok: 1, mdm: 0, noagent: 0 });
    expect(filterTiles(tiles, 'off', null).map((t) => t.device.id)).toEqual([2, 3]);
    expect(filterTiles(tiles, 'off', 4).map((t) => t.device.id)).toEqual([2]);
    expect(filterTiles(tiles, 'alle', 4)).toHaveLength(2);
  });

  it('puts a managed phone after the computers and a hand-kept one last', () => {
    const now = 1_790_000_000;
    const managed = device({
      id: 7,
      hostname: 'a-iphone',
      device_class: 'mobile',
      os: 'ios',
      online: false,
      mdm: {
        enrolled_at: now - 86400,
        last_seen_at: now - 60,
        checked_out_at: null,
        passcode_present: false,
        identity_expires_at: null,
        os_version: '18.6',
        os_status: 'outdated',
        os_latest: '26.0.1',
      },
    });
    const manual = device({ id: 8, hostname: 'b-tablet', device_class: 'mobile', os: 'android', online: false });
    const tiles = buildTiles([manual, managed, device({ id: 1 })], {}, [], now);
    expect(tiles.map((t) => [t.device.id, t.kind])).toEqual([
      [1, 'ok'],
      [7, 'mdm'],
      [8, 'noagent'],
    ]);
    expect(tiles[1]?.load).toEqual([]);
  });
});
