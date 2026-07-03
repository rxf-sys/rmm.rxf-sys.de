import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Account } from '../types';

export type AuthStatus = 'loading' | 'authed' | 'anon';

export interface AuthState {
  user: Account | null;
  status: AuthStatus;
  /** Throws on bad credentials — the caller surfaces the message. */
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Tracks the logged-in account. On mount it probes `/api/auth/me`; a 401
 * resolves to the anonymous state, which makes the app render the login page.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<Account | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .authMe()
      .then((r) => {
        if (!cancelled) {
          setUser(r.user);
          setStatus('authed');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setStatus('anon');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    setUser(r.user);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setStatus('anon');
    }
  }, []);

  return { user, status, login, logout };
}
