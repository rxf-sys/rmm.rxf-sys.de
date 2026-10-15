import type { Device } from '../../../types';

/** A healthy, connected Windows machine; override what the test is about. */
export function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: '11',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: { cpu_pct: 12, mem_pct: 40, disks: [{ mount: 'C:', used_pct: 50, total_b: 512_000_000_000 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
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

/** A phone without an agent: no live state, no agent tabs. */
export function phone(over: Partial<Device> = {}): Device {
  return device({
    os: 'ios',
    os_version: '18.6',
    online: false,
    connected: false,
    last_seen_at: null,
    device_class: 'mobile',
    ownership: 'private',
    ...over,
  });
}
