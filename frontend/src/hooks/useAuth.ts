import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { UNAUTHORIZED_EVENT, api } from '../api/client';
import type { Account } from '../types';
import { resetJobResults } from '../ui/toast';

export type AuthStatus = 'loading' | 'authed' | 'anon';

export interface AuthState {
  user: Account | null;
  status: AuthStatus;
  /** Throws on bad credentials — the caller surfaces the message. A thrown
   * "totp_required" tells the login page to ask for the second factor. */
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Tracks the logged-in account. On mount it probes `/api/auth/me`; a 401
 * resolves to the anonymous state, which makes the app render the login page.
 */
export function useAuth(): AuthState {
  const qc = useQueryClient();
  const [user, setUser] = useState<Account | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Leaving a session forgets everything it loaded. The app stays mounted
  // across sign-out, so without this the next account in the same tab would
  // see the previous one's fleet, device details and job results until each
  // refetch replaced them — and a 403/404 refetch keeps the old data.
  const signedOut = useCallback(() => {
    qc.clear();
    resetJobResults();
    setUser(null);
    setStatus('anon');
  }, [qc]);

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

  // A session can expire while the tab is open. Any 401 from any request
  // drops us back to the login page instead of leaving the dashboard sitting
  // behind an error banner that never resolves.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut);
  }, [signedOut]);

  const login = useCallback(async (username: string, password: string, totpCode?: string) => {
    const r = await api.login(username, password, totpCode);
    setUser(r.user);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      signedOut();
    }
  }, [signedOut]);

  return { user, status, login, logout };
}
