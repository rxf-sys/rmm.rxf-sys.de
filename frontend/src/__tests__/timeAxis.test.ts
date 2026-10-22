import { describe, expect, it } from 'vitest';
import { hhmm, ticksFor } from '../timeAxis';

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

describe('ticksFor', () => {
  it('puts ticks on every fourth full hour', () => {
    const ticks = ticksFor(at(2026, 10, 9, 1, 30), at(2026, 10, 9, 13, 10), 4 * 3600);
    expect(ticks.map(hhmm)).toEqual(['04:00', '08:00', '12:00']);
  });

  it('puts week ticks on local midnight, also across the DST change', () => {
    // 25.10.2026 is the end of summer time in Germany.
    const ticks = ticksFor(at(2026, 10, 23, 12), at(2026, 10, 27, 12), 86400);
    expect(ticks.map((t) => new Date(t * 1000).getHours())).toEqual([0, 0, 0, 0]);
    expect(ticks.map((t) => new Date(t * 1000).getDate())).toEqual([24, 25, 26, 27]);
  });
});
