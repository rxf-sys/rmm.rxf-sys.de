import { describe, expect, it } from 'vitest';
import { formatAgo } from '../format';

describe('formatAgo', () => {
  const now = new Date(2026, 9, 9, 12, 0).getTime() / 1000;

  it('stays short at every distance', () => {
    expect(formatAgo(now - 30, now)).toBe('gerade eben');
    expect(formatAgo(now - 5 * 60, now)).toBe('vor 5 min');
    expect(formatAgo(now - 3 * 3600, now)).toBe('vor 3 h');
    expect(formatAgo(now - 30 * 3600, now)).toBe('gestern');
    expect(formatAgo(now - 4 * 86400, now)).toBe('vor 4 Tagen');
  });

  it('turns into a date after a week', () => {
    expect(formatAgo(new Date(2026, 8, 16, 21, 16).getTime() / 1000, now)).toBe('16.09.2026');
  });

  it('says so when a device was never seen', () => {
    expect(formatAgo(null, now)).toBe('nie');
  });
});
