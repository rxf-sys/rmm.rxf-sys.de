import { describe, expect, it } from 'vitest';
import { percentAxis, segmentsOf } from '../fleetChart';
import type { FleetSample } from '../types';

const sample = (ts: number, cpu = 5): FleetSample => ({
  ts,
  cpu_avg: cpu,
  mem_avg: 0,
  disk_max: 0,
  samples: 1,
  devices: 1,
});

const HOUR = 3600;

describe('percentAxis', () => {
  const lines = ({ top, step }: { top: number; step: number }) =>
    Array.from({ length: top / step + 1 }, (_, i) => i * step);

  it('keeps a quiet fleet readable instead of flat on the floor', () => {
    // 5 bis 11 % auf einer 0–100-Skala ist eine Linie am unteren Rand.
    expect(percentAxis(11)).toEqual({ top: 15, step: 5 });
    expect(percentAxis(4)).toEqual({ top: 10, step: 2 });
  });

  it('labels every grid line with a round value', () => {
    // Viertel von 50 ergaben 13 und 38 — genau das stand im Screenshot.
    expect(lines(percentAxis(45))).toEqual([0, 10, 20, 30, 40, 50]);
    for (let max = 0; max <= 100; max += 0.7) {
      const axis = percentAxis(max);
      expect(Number.isInteger(axis.top / axis.step)).toBe(true);
      expect(axis.top / axis.step).toBeLessThanOrEqual(5);
    }
  });

  it('leaves room above the peak and never cuts it off', () => {
    for (const max of [0, 9.9, 10, 24, 25, 26, 50, 51, 99.9, 100]) {
      expect(percentAxis(max).top).toBeGreaterThanOrEqual(Math.min(100, max * 1.1));
    }
  });

  it('stops at 100', () => {
    expect(percentAxis(100)).toEqual({ top: 100, step: 25 });
  });
});

describe('segmentsOf', () => {
  it('keeps consecutive hours in one line', () => {
    const rows = [sample(HOUR), sample(2 * HOUR), sample(3 * HOUR)];
    expect(segmentsOf(rows)).toHaveLength(1);
  });

  it('breaks the line where nothing was measured', () => {
    // Nachts kein Gerät online: eine durchgezogene Linie würde Messwerte
    // behaupten, die es nicht gibt.
    const rows = [sample(HOUR), sample(2 * HOUR), sample(9 * HOUR), sample(10 * HOUR)];
    const segs = segmentsOf(rows);
    expect(segs.map((s) => s.length)).toEqual([2, 2]);
  });

  it('survives an empty series', () => {
    expect(segmentsOf([])).toEqual([]);
  });
});
