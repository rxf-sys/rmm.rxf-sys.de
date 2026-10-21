import { describe, expect, it } from 'vitest';
import type { Device, Role } from '../../../types';
import { buildPalette, quickTargets, roleOf, statusText, type PaletteModel } from '../paletteModel';
import { indexDevices } from '../ranking';
import { device, phone } from './fixtures';

const fleet = [
  device({ id: 1, hostname: 'buero-pc', owner_label: 'Lisa Berg' }),
  device({ id: 2, hostname: 'nas', os: 'linux', tags: ['Keller'] }),
  phone({ id: 3, hostname: 'iPhone von Lisa' }),
];

function build(query: string, opts: { role?: Role; recent?: number[]; devices?: Device[] } = {}): PaletteModel {
  return buildPalette({
    query,
    index: indexDevices(opts.devices ?? fleet),
    recent: opts.recent ?? [],
    role: opts.role ?? 'admin',
  });
}

const groupIds = (m: PaletteModel) => m.groups.map((g) => g.id);
const keys = (m: PaletteModel, group: string) => m.groups.find((g) => g.id === group)?.options.map((o) => o.key) ?? [];

describe('roleOf', () => {
  it('reads the role from the two flags App passes', () => {
    expect(roleOf(true, true)).toBe('admin');
    expect(roleOf(false, true)).toBe('techniker');
    expect(roleOf(false, false)).toBe('viewer');
  });
});

describe('empty query', () => {
  it('offers actions and pages, and recent devices when there are some', () => {
    expect(groupIds(build(''))).toEqual(['actions', 'pages']);
    const m = build('', { recent: [2, 99, 1] });
    expect(groupIds(m)).toEqual(['recent', 'actions', 'pages']);
    // Device 99 is gone (or hidden from this person): it drops out.
    expect(keys(m, 'recent')).toEqual(['device-2', 'quick-2-remote', 'quick-2-patches', 'quick-2-jobs', 'device-1']);
  });

  it('shows each role the pages and actions it may use', () => {
    expect(keys(build('', { role: 'admin' }), 'pages')).toHaveLength(10);
    expect(keys(build('', { role: 'admin' }), 'actions')).toEqual(['action-enroll', 'action-theme']);

    const tech = keys(build('', { role: 'techniker' }), 'pages');
    expect(tech).toContain('page-scripts');
    expect(tech).not.toContain('page-audit');
    expect(tech).not.toContain('page-admin');

    const viewer = build('', { role: 'viewer' });
    expect(keys(viewer, 'pages')).not.toContain('page-scripts');
    expect(keys(viewer, 'pages')).not.toContain('page-admin');
    expect(keys(viewer, 'actions')).toEqual(['action-theme']);
  });

  it('says nothing in the status line', () => {
    expect(statusText(build(''), '')).toBe('');
  });
});

describe('searching', () => {
  it('leads with the group that holds the best hit', () => {
    expect(groupIds(build('nas'))).toEqual(['devices']);
    expect(groupIds(build('geräte'))[0]).toBe('pages');
    // A prefix of a hostname outranks a prefix of a label (the hostname is
    // the heavier field); between equal groups the fixed order holds.
    const withStore = [...fleet, device({ id: 7, hostname: 'geraete-lager' })];
    expect(groupIds(build('ger', { devices: withStore }))).toEqual(['devices', 'actions', 'pages']);
  });

  it('finds pages and actions by the other words people use', () => {
    expect(keys(build('updates'), 'pages')).toEqual(['page-patches']);
    expect(keys(build('dunkel'), 'actions')).toEqual(['action-theme']);
    expect(keys(build('agent installieren', { role: 'viewer' }), 'actions')).toEqual([]);
  });

  it('adds quick targets under the top device only', () => {
    const m = build('lisa');
    expect(keys(m, 'devices')).toEqual(['device-1', 'quick-1-remote', 'quick-1-patches', 'quick-1-jobs', 'device-3']);
    expect(m.hits).toBe(2);
  });

  it('offers a viewer only the updates of the top device', () => {
    expect(keys(build('nas', { role: 'viewer' }), 'devices')).toEqual(['device-2', 'quick-2-patches']);
  });

  it('marks duplicate hostnames and names the tag behind a hit', () => {
    const twins = [device({ id: 4, hostname: 'kasse' }), device({ id: 5, hostname: 'Kasse', tags: ['Laden'] })];
    const opts = build('kasse', { devices: twins }).groups[0]?.options ?? [];
    expect(opts.filter((o) => o.kind === 'device').map((o) => o.kind === 'device' && o.showId)).toEqual([true, true]);
    const byTag = build('laden', { devices: twins }).groups[0]?.options[0];
    expect(byTag?.kind === 'device' && byTag.tag).toBe('Laden');
  });

  it('counts hits and says when the device list is cut short', () => {
    expect(statusText(build('nas'), 'nas')).toBe('1 Treffer');
    expect(statusText(build('zzz'), 'zzz')).toBe('Keine Treffer');
    const big = Array.from({ length: 1200 }, (_, i) => device({ id: i + 1, hostname: `pc-${i + 1}` }));
    const m = build('pc', { devices: big });
    expect(m.devicesShown).toBe(50);
    expect(statusText(m, 'pc')).toBe('50 von 1.200 Geräten gezeigt — Suche eingrenzen');
  });
});

describe('quickTargets', () => {
  it('follows the device page tabs: none for a phone', () => {
    expect(quickTargets(phone({ id: 3 }), 'admin')).toEqual([]);
  });

  it('keeps the terminal and the activity for operators', () => {
    expect(quickTargets(device(), 'techniker').map((q) => q.label)).toEqual(['Terminal', 'Updates', 'Aktivität']);
    expect(quickTargets(device(), 'viewer').map((q) => q.label)).toEqual(['Updates']);
  });
});
