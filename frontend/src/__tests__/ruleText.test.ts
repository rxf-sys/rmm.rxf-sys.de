import { describe, expect, it } from 'vitest';
import { affectedDevices, effectiveRule, humanSeconds, ruleSentence, ruleShort, scopeLabel, sinceLabel } from '../ruleText';
import type { AlertRule, Device, Person } from '../types';

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: 1,
  type: 'offline',
  enabled: true,
  threshold: null,
  scope_kind: 'all',
  scope_value: '',
  created_at: 0,
  ...over,
});

const device = (over: Partial<Device> = {}): Device => ({
  id: 1,
  hostname: 'pc-1',
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
  last_patch_scan_at: 0,
  ...over,
});

describe('humanSeconds', () => {
  it('reads like a person would say it', () => {
    expect(humanSeconds(300)).toBe('5 Minuten');
    expect(humanSeconds(60)).toBe('1 Minute');
    expect(humanSeconds(7200)).toBe('2 Stunden');
    expect(humanSeconds(86400)).toBe('1 Tag');
    expect(humanSeconds(45)).toBe('45 Sekunden');
  });
});

describe('ruleSentence', () => {
  it('turns a rule into a sentence instead of a data row', () => {
    expect(ruleSentence('offline', 300)).toBe(
      'Meldet sich ein Gerät länger als 5 Minuten nicht, löst das einen Alarm aus.',
    );
    expect(ruleSentence('disk', 90)).toBe('Überschreitet eine Platte 90 %, löst das einen Alarm aus.');
  });

  it('marks the server default instead of inventing a number', () => {
    expect(ruleSentence('patch_age', null)).toContain('30 Tage (Standard)');
  });
});

describe('ruleShort', () => {
  it('fits into a line of its own', () => {
    expect(ruleShort('offline', 300)).toBe('Gerät offline ab 5 Minuten');
    expect(ruleShort('disk', 85)).toBe('Disk-Belegung ab 85 %');
  });
});

describe('sinceLabel', () => {
  const now = 1_800_000_000;
  it('scales with the age of the condition', () => {
    expect(sinceLabel(now - 30, now)).toBe('gerade eben');
    expect(sinceLabel(now - 22 * 60, now)).toBe('seit 22 Min.');
    expect(sinceLabel(now - 9 * 3600, now)).toBe('seit 9 Std.');
    expect(sinceLabel(now - 6 * 86400, now)).toBe('seit 6 Tagen');
  });
});

describe('scopeLabel and affectedDevices', () => {
  const persons: Person[] = [
    { id: 2, name: 'Martina Fuchs', email: '', phone: '', notes: '', created_at: 0, device_count: 1 },
  ];

  it('names a person instead of showing its id', () => {
    expect(scopeLabel(rule({ scope_kind: 'person', scope_value: '2' }), persons)).toBe(
      'Person: Martina Fuchs',
    );
  });

  it('counts only the devices a rule applies to', () => {
    const devices = [device({ id: 1, tags: ['server'] }), device({ id: 2 })];
    expect(affectedDevices(rule({ scope_kind: 'tag', scope_value: 'server' }), devices)).toHaveLength(1);
    expect(affectedDevices(rule(), devices)).toHaveLength(2);
  });
});

describe('effectiveRule', () => {
  it('lets the most specific assignment win, like the server does', () => {
    // Person schlägt Tag schlägt „alle" — siehe effective_rule() im Backend.
    const d = device({ id: 5, tags: ['server'], person_id: 2 });
    const rules = [
      rule({ id: 1, scope_kind: 'all' }),
      rule({ id: 2, scope_kind: 'tag', scope_value: 'server' }),
      rule({ id: 3, scope_kind: 'person', scope_value: '2' }),
    ];
    expect(effectiveRule(rules, d, 'offline')?.id).toBe(3);
    expect(effectiveRule(rules.slice(0, 2), d, 'offline')?.id).toBe(2);
  });

  it('has no answer for a device it does not know', () => {
    expect(effectiveRule([rule()], undefined, 'offline')).toBeUndefined();
  });

  it('ignores rules of another type', () => {
    expect(effectiveRule([rule({ type: 'disk' })], device(), 'offline')).toBeUndefined();
  });
});
