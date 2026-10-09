import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { createQueryClient } from '../../api/queryClient';
import { createRefreshScheduler, useFleet } from '../useFleet';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      devices: vi.fn(() => Promise.resolve({ devices: [] })),
      alerts: vi.fn(() => Promise.resolve({ alerts: [] })),
      patchSummary: vi.fn(() => Promise.resolve({ summary: {} })),
      persons: vi.fn(() => Promise.resolve({ persons: [] })),
    },
    // No socket in jsdom: constructing one throws, which the hook retries
    // on its backoff schedule — irrelevant for these tests.
    openFleetSocket: vi.fn(() => {
      throw new Error('no socket in tests');
    }),
  };
});

describe('createRefreshScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of requests into one load per gap', async () => {
    const load = vi.fn(() => Promise.resolve());
    const s = createRefreshScheduler(load, 2_000);
    for (let i = 0; i < 50; i += 1) s.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i += 1) s.request();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    s.cancel();
  });

  it('queues exactly one follow-up while a load is in flight', async () => {
    let finish: () => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const s = createRefreshScheduler(load, 0);
    s.request({ immediate: true });
    s.request({ immediate: true });
    s.request({ immediate: true });
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    s.cancel();
  });

  it('does nothing after cancel', async () => {
    const load = vi.fn(() => Promise.resolve());
    const s = createRefreshScheduler(load, 1_000);
    s.cancel();
    s.request();
    s.request({ immediate: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).not.toHaveBeenCalled();
  });
});

/** One client per test; a client per render would itself change identities. */
function makeWrapper() {
  const client = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useFleet', () => {
  afterEach(() => vi.clearAllMocks());

  it('keeps refresh stable across renders', async () => {
    // A new refresh closure per render made App's login effect re-run on
    // every render — 569 requests per endpoint in ten idle seconds.
    const { result, rerender } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.refresh;
    rerender();
    rerender();
    expect(result.current.refresh).toBe(first);
  });

  it('fetches nothing before there is a session', async () => {
    const { result } = renderHook(() => useFleet(false), { wrapper: makeWrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.loading).toBe(false);
    expect(vi.mocked(api.devices)).not.toHaveBeenCalled();
  });

  it('does not refetch on its own after the first load', async () => {
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(api.devices)).toHaveBeenCalledTimes(1);
  });

  it('refetches on an explicit refresh', async () => {
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(vi.mocked(api.devices)).toHaveBeenCalledTimes(2));
  });
});
