import { describe, expect, it } from 'vitest';
import { lastScanSlot, nextWeekdayHour } from '../schedule';

/** 2026-09-11 ist ein Freitag (Montag = 0 ⇒ weekday 4). */
const FRIDAY_1200 = Math.floor(new Date(2026, 8, 11, 12, 0, 0).getTime() / 1000);

describe('nextWeekdayHour', () => {
  it('findet den nächsten Montag', () => {
    const ts = nextWeekdayHour(0, 3, FRIDAY_1200);
    const d = new Date(ts * 1000);
    expect(d.getDay()).toBe(1); // Montag
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(3);
  });

  it('nimmt heute, solange die Stunde noch kommt', () => {
    const ts = nextWeekdayHour(4, 23, FRIDAY_1200);
    expect(new Date(ts * 1000).getDate()).toBe(11);
  });

  it('springt eine Woche weiter, wenn die Stunde heute vorbei ist', () => {
    // Sonst stünde dort „läuft heute um 03:00" für einen Termin, der seit
    // neun Stunden vorbei ist.
    const ts = nextWeekdayHour(4, 3, FRIDAY_1200);
    expect(new Date(ts * 1000).getDate()).toBe(18);
  });
});

describe('lastScanSlot', () => {
  it('ist heute, sobald die Stunde vorbei ist', () => {
    expect(new Date(lastScanSlot(3, FRIDAY_1200) * 1000).getDate()).toBe(11);
  });

  it('ist gestern, solange die Stunde noch kommt', () => {
    expect(new Date(lastScanSlot(18, FRIDAY_1200) * 1000).getDate()).toBe(10);
  });
});
