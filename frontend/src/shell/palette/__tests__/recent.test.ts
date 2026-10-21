import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECENT, RECENT_KEY, loadRecent, rememberDevice } from '../recent';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('recent devices', () => {
  it('starts empty', () => {
    expect(loadRecent()).toEqual([]);
  });

  it('puts the newest first, once, and keeps a handful', () => {
    for (const id of [1, 2, 3, 2]) rememberDevice(id);
    expect(loadRecent()).toEqual([2, 3, 1]);
    for (let id = 10; id < 20; id++) rememberDevice(id);
    expect(loadRecent()).toHaveLength(MAX_RECENT);
    expect(loadRecent()[0]).toBe(19);
  });

  it('drops whatever is not a device id', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([4, 'x', -2, 1.5, null, 4, 7]));
    expect(loadRecent()).toEqual([4, 7]);
    localStorage.setItem(RECENT_KEY, '{"id":4}');
    expect(loadRecent()).toEqual([]);
    localStorage.setItem(RECENT_KEY, '[4,');
    expect(loadRecent()).toEqual([]);
  });

  it('survives storage that refuses to read or write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(rememberDevice(5)).toEqual([5]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadRecent()).toEqual([]);
  });
});
