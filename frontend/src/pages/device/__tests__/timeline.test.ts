import { describe, expect, it } from 'vitest';
import type { Alert, AuditEvent, Job } from '../../../types';
import { buildTimeline, byDay, jobTitle } from '../timeline';

const job = (over: Partial<Job>): Job => ({
  id: 1,
  device_id: 1,
  kind: 'shell',
  command: 'df -h',
  shell: 'bash',
  script_id: null,
  script_name: '',
  status: 'done',
  exit_code: 0,
  created_by: 'robin',
  created_at: 100,
  started_at: 100,
  finished_at: 101,
  ...over,
});
const alert = (over: Partial<Alert>): Alert => ({
  id: 1,
  device_id: 1,
  rule: 'disk',
  message: 'Platte voll',
  fired_at: 50,
  resolved_at: null,
  notified: true,
  acked_at: null,
  acked_by: '',
  ...over,
});
const audit = (over: Partial<AuditEvent>): AuditEvent => ({
  id: 1,
  ts: 75,
  event: 'devices.updated',
  actor: 'robin',
  device_id: 1,
  detail: {},
  category: 'device',
  security: false,
  ...over,
});

describe('buildTimeline', () => {
  it('merges the three sources newest first', () => {
    const t = buildTimeline([job({ created_at: 100 })], [alert({ fired_at: 50 })], [audit({ ts: 75 })]);
    expect(t.map((e) => e.kind)).toEqual(['job', 'change', 'alert']);
  });

  it('shows a resolved alert twice: when it fired and when it cleared', () => {
    const t = buildTimeline([], [alert({ fired_at: 50, resolved_at: 80 })], []);
    expect(t.map((e) => (e.kind === 'alert' ? e.resolved : null))).toEqual([true, false]);
  });

  it('drops audit events the jobs and alerts already show', () => {
    const t = buildTimeline([], [], [audit({ event: 'job.created' }), audit({ id: 2, event: 'alert.fired' }), audit({ id: 3 })]);
    expect(t).toHaveLength(1);
  });

  it('names jobs by what they ran', () => {
    expect(jobTitle(job({ kind: 'script', script_name: 'Bereinigen' }))).toBe('Skript: Bereinigen');
    expect(jobTitle(job({ kind: 'patch_install' }))).toBe('Updates installiert');
    expect(jobTitle(job({ command: 'uptime' }))).toBe('uptime');
  });
});

describe('byDay', () => {
  it('groups consecutive entries of one day', () => {
    const t = buildTimeline([job({ id: 1, created_at: 3 }), job({ id: 2, created_at: 2 }), job({ id: 3, created_at: 1 })], [], []);
    const groups = byDay(t, (ts) => (ts >= 2 ? 'Heute' : 'Gestern'));
    expect(groups.map((g) => [g.day, g.entries.length])).toEqual([
      ['Heute', 2],
      ['Gestern', 1],
    ]);
  });
});
