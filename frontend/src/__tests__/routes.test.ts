import { describe, expect, it } from 'vitest';
import { PAGE_LABEL, PAGE_PATH, devicePath, pageForPath } from '../routes';

describe('routes', () => {
  it('maps every page id to a path and a label', () => {
    const ids = Object.keys(PAGE_PATH);
    expect(Object.keys(PAGE_LABEL).sort()).toEqual(ids.sort());
    expect(new Set(Object.values(PAGE_PATH)).size).toBe(ids.length);
  });

  it('resolves a path back to its page id', () => {
    for (const [id, path] of Object.entries(PAGE_PATH)) {
      expect(pageForPath(path)).toBe(id);
    }
  });

  it('keeps the devices section highlighted on a device page', () => {
    expect(pageForPath(devicePath(42))).toBe('devices');
    expect(devicePath(42)).toBe('/devices/42');
  });

  it('tolerates trailing slashes and unknown paths', () => {
    expect(pageForPath('/patches/')).toBe('patches');
    expect(pageForPath('')).toBe('overview');
    expect(pageForPath('/gibt-es-nicht')).toBe('overview');
  });
});
