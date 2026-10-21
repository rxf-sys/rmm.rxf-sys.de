import { describe, expect, it } from 'vitest';
import { assignDotStates, fieldDots } from '../bootPlan';

describe('fieldDots', () => {
  it('keeps the centre free for the fox', () => {
    const dots = fieldDots(1440, 900);
    const inner = 900 * 0.24;
    for (const d of dots) expect(Math.hypot(d.x - 720, (d.y - 450) * 1.2)).toBeGreaterThanOrEqual(inner);
  });

  it('is the same on every visit', () => {
    expect(fieldDots(390, 844)).toEqual(fieldDots(390, 844));
  });
});

describe('assignDotStates', () => {
  it('adds up to the number of dots', () => {
    expect(assignDotStates(100, { ok: 7, warn: 1, danger: 2, off: 1 })).toHaveLength(100);
  });

  it('never rounds a single critical device away', () => {
    const states = assignDotStates(60, { ok: 9_999, warn: 0, danger: 1, off: 0 });
    expect(states.filter((s) => s === 'danger')).toHaveLength(1);
  });

  it('is all calm for an empty fleet', () => {
    expect(new Set(assignDotStates(10, { ok: 0, warn: 0, danger: 0, off: 0 }))).toEqual(new Set(['ok']));
  });
});
