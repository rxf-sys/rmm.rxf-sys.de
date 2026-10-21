import { describe, expect, it } from 'vitest';
import { compareVersions, newestVersion } from '../version';

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.8.2', '1.8.10')).toBeLessThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });

  it('picks the newest of a fleet', () => {
    expect(newestVersion(['0.9.0', '0.10.0', '', '0.10.0'])).toBe('0.10.0');
    expect(newestVersion([])).toBe('');
  });
});
