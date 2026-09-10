import { describe, expect, it } from 'vitest';
import { deviceState, diskColor, loadColor, loadLevel } from '../deviceStatus';
import type { Device } from '../types';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'test',
    owner_label: '',
    os: 'linux',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.4.2',
    tags: [],
    heartbeat: {},
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 0,
    online: true,
    connected: true,
    agent_update_available: null,
    ...over,
  };
}

describe('loadLevel', () => {
  it('tolerates more CPU than RAM', () => {
    expect(loadLevel(72, 'cpu')).toBe('warn');
    expect(loadLevel(72, 'ram')).toBe('ok');
  });

  it.each([
    ['cpu', 69, 'ok'],
    ['cpu', 70, 'warn'],
    ['cpu', 89, 'warn'],
    ['cpu', 90, 'crit'],
    ['ram', 74, 'ok'],
    ['ram', 75, 'warn'],
    ['ram', 90, 'crit'],
    ['disk', 79, 'ok'],
    ['disk', 80, 'warn'],
    ['disk', 90, 'crit'],
  ] as const)('%s at %i%% is %s', (kind, pct, expected) => {
    expect(loadLevel(pct, kind)).toBe(expected);
  });
});

describe('loadColor', () => {
  it('is green while fine and red once critical', () => {
    expect(loadColor(10, 'cpu')).toBe('var(--ok)');
    expect(loadColor(80, 'cpu')).toBe('var(--warn)');
    expect(loadColor(95, 'cpu')).toBe('var(--dangerS)');
  });
});

describe('diskColor and deviceState', () => {
  // If these two disagreed, one row would show a green status dot next to a
  // red disk bar for the same device.
  it.each([50, 79, 80, 89, 90, 100])('agree at %i%%', (pct) => {
    const d = device({ heartbeat: { disks: [{ mount: '/', used_pct: pct, total_b: 1 }] } });
    const state = deviceState(d);
    const expected =
      state === 'crit' ? 'var(--dangerS)' : state === 'warn' ? 'var(--warn)' : 'var(--ok)';
    expect(diskColor(pct)).toBe(expected);
  });
});
