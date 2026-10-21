import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client';

function answer(body: unknown) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api.alerts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for as much resolved history as the server hands out', async () => {
    // Without a limit the server stopped at 50 rows; the history tab's
    // "100" and "alle" page sizes could never fill.
    const fetchMock = answer({ alerts: [], resolved_limit: 200, resolved_truncated: true });
    const r = await api.alerts();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/alerts?limit=200');
    expect(r.resolved_truncated).toBe(true);
    expect(r.resolved_limit).toBe(200);
  });

  it('reads an answer without the truncation fields as complete', async () => {
    answer({ alerts: [] });
    const r = await api.alerts();
    expect(r.resolved_truncated).toBe(false);
  });
});
