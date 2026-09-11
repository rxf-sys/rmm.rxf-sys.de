import { describe, expect, it } from 'vitest';
import { niceCeiling, segmentsOf } from '../fleetChart';
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

describe('niceCeiling', () => {
  it('keeps a quiet fleet readable instead of flat on the floor', () => {
    // Genau der Fall aus dem Screenshot: 5 bis 11 % auf einer 0–100-Skala
    // ist eine Linie am unteren Rand.
    expect(niceCeiling(11)).toBe(25);
    expect(niceCeiling(4)).toBe(10);
  });

  it('never cuts the peak off', () => {
    for (const max of [0, 9.9, 10, 24, 25, 26, 50, 51, 99.9, 100]) {
      expect(niceCeiling(max)).toBeGreaterThanOrEqual(max);
    }
  });

  it('stops at 100', () => {
    expect(niceCeiling(100)).toBe(100);
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
