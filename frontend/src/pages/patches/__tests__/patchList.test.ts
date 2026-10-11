import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Device, PatchSummary } from '../../../types';
import {
  DEFAULT_SORT,
  STALE_AFTER_S,
  categoryOf,
  categoryStats,
  currentLevel,
  currentPct,
  emptyText,
  formatSort,
  isForbidden,
  isOsFilter,
  isStateFilter,
  matchesConn,
  matchesOs,
  matchesQuery,
  matchesState,
  names,
  nextSort,
  onDevices,
  parseSort,
  patchStats,
  pendingOf,
  scanStale,
  securityOf,
  sortDevices,
  type ListContext,
} from '../patchList';

const NOW = 1_800_000_000;

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: 'Windows 11 Pro',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: {},
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: NOW,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: NOW - 3600,
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

const ctx = (ps: PatchSummary, people: Record<number, string> = {}): ListContext => ({
  patchSummary: ps,
  personName: (id) => (id === null ? '' : (people[id] ?? '')),
});

describe('categoryOf', () => {
  it('trennt Windows nach Rolle und fasst den Rest zusammen', () => {
    expect(categoryOf({ os: 'windows', tags: [] })).toBe('win_pc');
    expect(categoryOf({ os: 'windows', tags: ['server'] })).toBe('win_server');
    expect(categoryOf({ os: 'darwin', tags: ['server'] })).toBe('mac');
    expect(categoryOf({ os: 'linux', tags: [] })).toBe('linux');
  });

  it('erkennt gültige Filterwerte aus der Adresse', () => {
    expect(isOsFilter('win_server')).toBe(true);
    expect(isOsFilter('solaris')).toBe(false);
    expect(isOsFilter(null)).toBe(false);
    expect(matchesOs({ os: 'linux', tags: [] }, 'alle')).toBe(true);
    expect(matchesOs({ os: 'linux', tags: [] }, 'mac')).toBe(false);
  });
});

describe('Zahlen je Gerät', () => {
  it('nennt ohne Bericht keine Null, sondern nichts', () => {
    expect(pendingOf(device({ last_patch_scan_at: 0 }), {})).toBeNull();
    expect(pendingOf(device(), {})).toBe(0);
    expect(pendingOf(device(), { '1': { pending: 4, security: 1 } })).toBe(4);
    expect(securityOf(device(), { '1': { pending: 4, security: 1 } })).toBe(1);
    expect(securityOf(device(), {})).toBe(0);
  });

  it('hält einen Scan nach 24 Stunden für veraltet', () => {
    expect(scanStale(device({ last_patch_scan_at: NOW - STALE_AFTER_S + 60 }), NOW)).toBe(false);
    expect(scanStale(device({ last_patch_scan_at: NOW - STALE_AFTER_S }), NOW)).toBe(true);
    expect(scanStale(device({ last_patch_scan_at: 0 }), NOW)).toBe(true);
  });
});

describe('matchesState', () => {
  const ps: PatchSummary = { '1': { pending: 3, security: 1 }, '2': { pending: 2, security: 0 } };
  const sec = device({ id: 1 });
  const open = device({ id: 2 });
  const current = device({ id: 3 });
  const never = device({ id: 4, last_patch_scan_at: 0 });
  const old = device({ id: 5, last_patch_scan_at: NOW - 3 * 86400 });
  const all = [sec, open, current, never, old];
  const ids = (f: Parameters<typeof matchesState>[1]) => all.filter((d) => matchesState(d, f, ps, NOW)).map((d) => d.id);

  it('hat für jeden Filter genau eine Regel', () => {
    expect(ids('alle')).toEqual([1, 2, 3, 4, 5]);
    expect(ids('sicherheit')).toEqual([1]);
    expect(ids('offen')).toEqual([1, 2]);
    // Nie geprüft ist nicht aktuell, sondern unbekannt.
    expect(ids('aktuell')).toEqual([3, 5]);
    expect(ids('ungeprueft')).toEqual([4, 5]);
  });

  it('erkennt gültige Filterwerte aus der Adresse', () => {
    expect(isStateFilter('sicherheit')).toBe(true);
    expect(isStateFilter('kaputt')).toBe(false);
  });
});

describe('Verbindung und Suche', () => {
  it('folgt der offenen Verbindung, nicht dem Online-Status', () => {
    const lingering = device({ online: true, connected: false });
    expect(matchesConn(lingering, 'verbunden')).toBe(false);
    expect(matchesConn(lingering, 'offline')).toBe(true);
    expect(matchesConn(lingering, 'alle')).toBe(true);
  });

  it('sucht in Name, Person, Tags und System', () => {
    const d = device({ hostname: 'srv-keller', tags: ['backup'], os: 'linux', os_version: 'Debian 12' });
    expect(matchesQuery(d, '  KELLER ', '')).toBe(true);
    expect(matchesQuery(d, 'backup', '')).toBe(true);
    expect(matchesQuery(d, 'debian', '')).toBe(true);
    expect(matchesQuery(d, 'lisa', 'Lisa Berg')).toBe(true);
    expect(matchesQuery(d, 'windows', '')).toBe(false);
    expect(matchesQuery(d, '', '')).toBe(true);
  });
});

describe('Sortierung', () => {
  const ps: PatchSummary = { '1': { pending: 9, security: 0 }, '2': { pending: 2, security: 2 }, '3': { pending: 4, security: 2 } };
  const list = [
    device({ id: 1, hostname: 'viel' }),
    device({ id: 2, hostname: 'sicher-a' }),
    device({ id: 3, hostname: 'sicher-b' }),
    device({ id: 4, hostname: 'nie', last_patch_scan_at: 0, connected: false }),
    device({ id: 5, hostname: 'leer' }),
  ];
  const order = (raw: string | null) => sortDevices(list, parseSort(raw), ctx(ps)).map((d) => d.hostname);

  it('stellt Sicherheitsupdates vor alles andere und Unbekanntes ans Ende', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'security', dir: 'desc' });
    expect(order(null)).toEqual(['sicher-b', 'sicher-a', 'viel', 'leer', 'nie']);
    expect(order('security')).toEqual(['leer', 'viel', 'sicher-a', 'sicher-b', 'nie']);
  });

  it('sortiert nach offenen Updates, nach Prüfung und nach Verbindung', () => {
    expect(order('-pending')).toEqual(['viel', 'sicher-b', 'sicher-a', 'leer', 'nie']);
    expect(order('scan')[0]).toBe('nie');
    expect(order('conn')[0]).toBe('nie');
    expect(order('name')).toEqual(['leer', 'nie', 'sicher-a', 'sicher-b', 'viel']);
  });

  it('sortiert nach Person und lässt Geräte ohne Person hinten', () => {
    const people = [device({ id: 1, hostname: 'a', person_id: 7 }), device({ id: 2, hostname: 'b' }), device({ id: 3, hostname: 'c', owner_label: 'Anna' })];
    const sorted = sortDevices(people, { key: 'person', dir: 'asc' }, ctx({}, { 7: 'Zoe' }));
    expect(sorted.map((d) => d.hostname)).toEqual(['c', 'a', 'b']);
  });

  it('liest und schreibt die Sortierung der Adresse', () => {
    expect(parseSort('-scan')).toEqual({ key: 'scan', dir: 'desc' });
    expect(parseSort('unsinn')).toEqual(DEFAULT_SORT);
    expect(formatSort(DEFAULT_SORT)).toBeNull();
    expect(formatSort({ key: 'pending', dir: 'desc' })).toBe('-pending');
    expect(nextSort(DEFAULT_SORT, 'security')).toEqual({ key: 'security', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'scan')).toEqual({ key: 'scan', dir: 'asc' });
  });
});

describe('Kennzahlen', () => {
  const ps: PatchSummary = { '1': { pending: 3, security: 2 }, '2': { pending: 5, security: 0 } };
  const list = [
    device({ id: 1 }),
    device({ id: 2, os: 'linux' }),
    device({ id: 3, os: 'linux' }),
    device({ id: 4, last_patch_scan_at: 0, tags: ['server'] }),
    device({ id: 5, os: 'darwin', last_patch_scan_at: NOW - 2 * 86400 }),
  ];

  it('zählt offene Updates, Sicherheitsupdates und alte Prüfungen', () => {
    expect(patchStats(list, ps, NOW)).toEqual({
      devices: 5,
      withPending: 2,
      pending: 8,
      security: 2,
      securityDevices: 1,
      stale: 2,
      never: 1,
      current: 2,
    });
  });

  it('nennt den Stand je System nur für vorhandene Systeme', () => {
    expect(categoryStats(list, ps)).toEqual([
      { id: 'win_pc', total: 1, current: 0 },
      { id: 'win_server', total: 1, current: 0 },
      { id: 'mac', total: 1, current: 1 },
      { id: 'linux', total: 2, current: 1 },
    ]);
    expect(categoryStats([device({ os: 'linux' })], {})).toEqual([{ id: 'linux', total: 1, current: 1 }]);
  });

  it('rundet nie auf 100 % auf', () => {
    expect(currentPct(199, 200)).toBe(99);
    expect(currentPct(200, 200)).toBe(100);
    expect(currentPct(0, 0)).toBe(0);
    expect(currentLevel(95)).toBe('ok');
    expect(currentLevel(75)).toBe('warn');
    expect(currentLevel(10)).toBe('crit');
  });
});

describe('Texte', () => {
  it('benennt Geräte kurz', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((h, i) => device({ id: i, hostname: h }));
    expect(names(many.slice(0, 2))).toBe('a, b');
    expect(names(many)).toBe('a, b, c, d und 2 weitere');
    expect(onDevices(1)).toBe('1 Gerät');
    expect(onDevices(1200)).toBe('1.200 Geräten');
  });

  it('sagt gute Nachrichten als solche', () => {
    expect(emptyText('sicherheit', false).title).toBe('Keine offenen Sicherheitsupdates');
    expect(emptyText('ungeprueft', false).title).toBe('Alle Geräte sind geprüft');
    expect(emptyText('sicherheit', true)).toEqual({ title: 'Keine Geräte gefunden', text: 'Kein Gerät passt zu Filter und Suche zusammen.' });
    expect(emptyText('alle', false)).toEqual({ title: 'Keine Geräte gefunden', text: null });
  });

  it('erkennt fehlende Rechte', () => {
    expect(isForbidden(new ApiError(403, '{"detail":"nope"}'))).toBe(true);
    expect(isForbidden(new ApiError(409, ''))).toBe(false);
    expect(isForbidden(new Error('x'))).toBe(false);
  });
});
