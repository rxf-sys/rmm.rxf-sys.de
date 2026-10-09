import { describe, expect, it } from 'vitest';
import { AlertsResponse, DeviceDetailResponse, DevicesResponse, ResponseShapeError, check } from '../schemas';

const device = {
  id: 7,
  hostname: 'nas-keller',
  owner_label: '',
  os: 'linux',
  os_version: 'Debian 12',
  arch: 'amd64',
  agent_version: '1.8.2',
  tags: ['server'],
  heartbeat: { cpu_pct: 4, disks: [{ mount: '/', used_pct: 93, total_b: 512 }] },
  rustdesk_id: '',
  person_id: null,
  maintenance_until: null,
  created_at: 1,
  last_seen_at: 2,
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
};

describe('response schemas', () => {
  it('accepts a well-formed device list', () => {
    const r = check(DevicesResponse, '/api/devices', { devices: [device] });
    expect(r.devices[0]?.hostname).toBe('nas-keller');
    expect(r.devices[0]?.heartbeat.disks?.[0]?.used_pct).toBe(93);
  });

  it('degrades a malformed field instead of failing the list', () => {
    const odd = { ...device, tags: 'server', online: 'yes', heartbeat: { cpu_pct: 'n/a' } };
    const r = check(DevicesResponse, '/api/devices', { devices: [odd] });
    expect(r.devices[0]?.tags).toEqual([]);
    expect(r.devices[0]?.online).toBe(false);
    expect(r.devices[0]?.heartbeat.cpu_pct).toBeUndefined();
  });

  it('names the field when identity is missing', () => {
    const broken = { ...device, hostname: undefined };
    expect(() => check(DevicesResponse, '/api/devices', { devices: [broken] })).toThrow(
      ResponseShapeError,
    );
    expect(() => check(DevicesResponse, '/api/devices', { devices: [broken] })).toThrow(
      /devices\.0\.hostname/,
    );
  });

  it('keeps fields it does not know', () => {
    const r = check(DevicesResponse, '/api/devices', {
      devices: [{ ...device, future_field: 42 }],
    });
    expect((r.devices[0] as unknown as Record<string, unknown>).future_field).toBe(42);
  });

  it('tolerates a detail response without inventory', () => {
    const r = check(DeviceDetailResponse, '/api/devices/7', { device, inventory: null });
    expect(r.inventory).toEqual({});
  });

  it('rejects an alert list that is not a list', () => {
    expect(() => check(AlertsResponse, '/api/alerts', { alerts: 'nope' })).toThrow(/alerts/);
  });
});
