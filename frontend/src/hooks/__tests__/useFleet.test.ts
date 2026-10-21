import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../api/client';
import { createQueryClient, qk } from '../../api/queryClient';
import type { QueryClient } from '@tanstack/react-query';
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
function makeWrapper(client: QueryClient = createQueryClient()) {
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

  it('says how many resolved alerts the server kept when it left older ones out', async () => {
    vi.mocked(api.alerts).mockResolvedValueOnce({ alerts: [], resolved_limit: 200, resolved_truncated: true });
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolvedAlertsCap).toBe(200);
  });

  it('reports no cut when the history is complete', async () => {
    vi.mocked(api.alerts).mockResolvedValueOnce({ alerts: [], resolved_limit: 200, resolved_truncated: false });
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolvedAlertsCap).toBeNull();
  });

  it('keeps the last patch summary when a refresh fails, and lets the retry policy see the error', async () => {
    // A failure used to resolve to an empty summary: every device read as
    // up to date, and nothing retried.
    vi.mocked(api.patchSummary)
      .mockResolvedValueOnce({ summary: { '1': { pending: 12, security: 12 } } })
      .mockRejectedValue(new ApiError(502, 'Bad Gateway'));
    const client = createQueryClient();
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.patchSummary['1']?.pending).toBe(12));
    act(() => result.current.refresh());
    await waitFor(() => expect(client.getQueryState(qk.patchSummary)?.fetchFailureCount).toBeGreaterThan(0));
    expect(result.current.patchSummary['1']?.pending).toBe(12);
    await client.cancelQueries();
  });

  it('keeps the last persons list when a refresh fails', async () => {
    const anna = { id: 1, name: 'Anna', email: '', phone: '', notes: '', created_at: 0, device_count: 0 };
    vi.mocked(api.persons)
      .mockResolvedValueOnce({ persons: [anna] })
      .mockRejectedValue(new ApiError(502, 'Bad Gateway'));
    const client = createQueryClient();
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper(client) });
    await waitFor(() => expect(result.current.persons).toEqual([anna]));
    act(() => result.current.refresh());
    await waitFor(() => expect(client.getQueryState(qk.persons)?.fetchFailureCount).toBeGreaterThan(0));
    expect(result.current.persons).toEqual([anna]);
    await client.cancelQueries();
  });

  it('tells a device list that never arrived from an empty one', async () => {
    // A 4xx is not retried, so the first load fails at once.
    vi.mocked(api.devices).mockRejectedValueOnce(new ApiError(400, 'kaputt'));
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices).toEqual([]);
    expect(result.current.loadErrors.devices).toBeInstanceOf(ApiError);
    expect(result.current.loadErrors.patchSummary).toBeNull();
  });

  it('refetches on an explicit refresh', async () => {
    const { result } = renderHook(() => useFleet(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(vi.mocked(api.devices)).toHaveBeenCalledTimes(2));
  });
});
