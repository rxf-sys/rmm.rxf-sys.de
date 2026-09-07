import { act, renderHook, waitFor } from '@testing-library/react';
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

describe('useAuth', () => {
  afterEach(() => vi.clearAllMocks());

  it('resolves to authed when /api/auth/me answers', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authed'));
    expect(result.current.user?.username).toBe('boss');
  });

  it('drops to anon when any request reports 401', async () => {
    // A session expiring mid-visit used to leave every screen behind an
    // error banner that never resolved.
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authed'));

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(result.current.status).toBe('anon');
    expect(result.current.user).toBeNull();
  });

  it('stops listening after unmount', async () => {
    const { result, unmount } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authed'));
    unmount();
    // No state update on an unmounted hook — React would warn, and the
    // listener must be gone.
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  });
});
