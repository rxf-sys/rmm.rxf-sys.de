import { describe, expect, it } from 'vitest';
import type { Device } from '../../../types';
import { csvDate, formatSort, nextSort, parseSort, sortDevices, toCsv, type ListContext } from '../deviceList';

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
    heartbeat: {},
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

const ctx: ListContext = { patchSummary: {}, personName: () => '' };
const names = (ds: Device[]) => ds.map((d) => d.hostname);

describe('sort params', () => {
  it('round-trips through the URL and falls back on junk', () => {
    expect(parseSort('-cpu')).toEqual({ key: 'cpu', dir: 'desc' });
    expect(parseSort('name')).toEqual({ key: 'name', dir: 'asc' });
    expect(parseSort('drop table')).toEqual(parseSort(null));
    expect(formatSort(parseSort(null))).toBeNull();
    expect(formatSort({ key: 'disk', dir: 'desc' })).toBe('-disk');
  });

  it('starts a new column in its natural direction and flips the same one', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'disk')).toEqual({ key: 'disk', dir: 'desc' });
    expect(nextSort({ key: 'disk', dir: 'desc' }, 'disk')).toEqual({ key: 'disk', dir: 'asc' });
  });
});

describe('sortDevices', () => {
  it('puts missing measurements last in both directions', () => {
    const list = [
      device({ id: 1, hostname: 'aus', online: false, heartbeat: { cpu_pct: 99 } }),
      device({ id: 2, hostname: 'hoch', heartbeat: { cpu_pct: 80 } }),
      device({ id: 3, hostname: 'tief', heartbeat: { cpu_pct: 10 } }),
    ];
    expect(names(sortDevices(list, { key: 'cpu', dir: 'desc' }, ctx))).toEqual(['hoch', 'tief', 'aus']);
    expect(names(sortDevices(list, { key: 'cpu', dir: 'asc' }, ctx))).toEqual(['tief', 'hoch', 'aus']);
  });

  it('compares agent versions as versions', () => {
    const list = [
      device({ id: 1, hostname: 'neu', agent_version: '0.10.0' }),
      device({ id: 2, hostname: 'alt', agent_version: '0.9.3' }),
    ];
    expect(names(sortDevices(list, { key: 'agent', dir: 'asc' }, ctx))).toEqual(['alt', 'neu']);
  });

  it('sorts hostnames naturally and breaks ties by name', () => {
    const list = [device({ id: 1, hostname: 'pc-10' }), device({ id: 2, hostname: 'pc-2' })];
    expect(names(sortDevices(list, { key: 'name', dir: 'asc' }, ctx))).toEqual(['pc-2', 'pc-10']);
    expect(names(sortDevices(list, { key: 'status', dir: 'desc' }, ctx))).toEqual(['pc-2', 'pc-10']);
  });

  it('ranks security updates above any number of others', () => {
    const list = [device({ id: 1, hostname: 'viele' }), device({ id: 2, hostname: 'kritisch' })];
    const withPatches: ListContext = {
      ...ctx,
      patchSummary: { '1': { pending: 40, security: 0 }, '2': { pending: 1, security: 1 } },
    };
    expect(names(sortDevices(list, { key: 'updates', dir: 'desc' }, withPatches))).toEqual(['kritisch', 'viele']);
  });
});

describe('toCsv', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    const csv = toCsv([device({ hostname: '=HYPERLINK("http://x")' })], ctx);
    const row = csv.split('\r\n')[1]!;
    expect(row.startsWith(`"'=HYPERLINK(""http://x"")"`)).toBe(true);
  });

  it('starts with a BOM and a German header, separated by semicolons', () => {
    const csv = toCsv([device({ tags: ['server', 'keller'], heartbeat: { cpu_pct: 33.4 } })], ctx);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header!.split(';')[0]).toBe('Hostname');
    const cells = row!.split(';');
    expect(cells[5]).toBe('server, keller');
    expect(cells[6]).toBe('33');
  });

  it('writes dates as TT.MM.JJJJ HH:MM', () => {
    expect(csvDate(new Date(2026, 9, 9, 7, 5).getTime() / 1000)).toBe('09.10.2026 07:05');
    expect(csvDate(null)).toBe('');
  });
});
