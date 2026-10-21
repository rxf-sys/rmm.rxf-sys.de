import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { useFleetLoad } from '../fleetLoading';

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

async function failed(client: QueryClient, key: readonly unknown[], error: Error) {
  await client.prefetchQuery({ queryKey: key, queryFn: () => Promise.reject(error), retry: false });
}

describe('useFleetLoad', () => {
  it('reports a patch summary whose first load failed', async () => {
    const client = new QueryClient();
    client.setQueryData(qk.devices, []);
    const err = new ApiError(500, 'kaputt');
    await failed(client, qk.patchSummary, err);
    const { result } = renderHook(() => useFleetLoad(), { wrapper: wrapper(client) });
    expect(result.current.error).toBe(err);
  });

  it('keeps showing a summary that arrived before a refresh failed', async () => {
    const client = new QueryClient();
    client.setQueryData(qk.devices, []);
    client.setQueryData(qk.patchSummary, { '1': { pending: 3, security: 0 } });
    await client.fetchQuery({ queryKey: qk.patchSummary, queryFn: () => Promise.reject(new ApiError(502, '')), retry: false, staleTime: 0 }).catch(() => {});
    const { result } = renderHook(() => useFleetLoad(), { wrapper: wrapper(client) });
    expect(client.getQueryState(qk.patchSummary)?.status).toBe('error');
    expect(result.current.error).toBeNull();
  });

  it('reports a device list whose first load failed first', async () => {
    const client = new QueryClient();
    const devErr = new ApiError(500, 'devices');
    await failed(client, qk.devices, devErr);
    await failed(client, qk.patchSummary, new ApiError(500, 'summary'));
    const { result } = renderHook(() => useFleetLoad(), { wrapper: wrapper(client) });
    expect(result.current.error).toBe(devErr);
  });
});
