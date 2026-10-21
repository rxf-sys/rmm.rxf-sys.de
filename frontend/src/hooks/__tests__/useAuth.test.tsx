import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNAUTHORIZED_EVENT } from '../../api/client';
import { useAuth } from '../useAuth';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      authMe: vi.fn(() => Promise.resolve({ user: { id: 1, username: 'boss', role: 'admin' } })),
      login: vi.fn(),
      logout: vi.fn(() => Promise.resolve({})),
    },
  };
});

/** The hook clears the query cache on sign-out, so it needs a client. The
 *  client starts with data a previous account loaded. */
function setup() {
  const client = new QueryClient();
  client.setQueryData(['fleet', 'devices'], [{ id: 7, hostname: 'nas' }]);
  client.setQueryData(['device', 7], { device: { id: 7 } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useAuth(), { wrapper }) };
}

describe('useAuth', () => {
  afterEach(() => vi.clearAllMocks());

  it('resolves to authed when /api/auth/me answers', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('authed'));
    expect(result.current.user?.username).toBe('boss');
  });

  it('drops to anon when any request reports 401', async () => {
    // A session expiring mid-visit used to leave every screen behind an
    // error banner that never resolved.
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('authed'));

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(result.current.status).toBe('anon');
    expect(result.current.user).toBeNull();
  });

  it('stops listening after unmount', async () => {
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.status).toBe('authed'));
    unmount();
    // No state update on an unmounted hook — React would warn, and the
    // listener must be gone.
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  });

  it('forgets every loaded query on sign-out', async () => {
    // The app stays mounted across sign-out; the next account in this tab
    // must not see the previous one's fleet or device details.
    const { client, result } = setup();
    await waitFor(() => expect(result.current.status).toBe('authed'));
    await act(() => result.current.logout());
    expect(result.current.status).toBe('anon');
    expect(client.getQueryData(['fleet', 'devices'])).toBeUndefined();
    expect(client.getQueryData(['device', 7])).toBeUndefined();
  });

  it('forgets them too when the session expires', async () => {
    const { client, result } = setup();
    await waitFor(() => expect(result.current.status).toBe('authed'));
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(client.getQueryData(['fleet', 'devices'])).toBeUndefined();
  });
});
