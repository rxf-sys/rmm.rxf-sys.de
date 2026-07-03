import type { Account, Device } from '../types';

class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}: ${body}`);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { credentials: 'include', signal });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new ApiError(r.status, text);
  }
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new ApiError(r.status, text);
  }
  return r.json() as Promise<T>;
}

/** Pull a human-readable message out of an ApiError's JSON body. */
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.body) as { detail?: string };
      if (parsed.detail) return parsed.detail;
    } catch {
      /* body wasn't JSON */
    }
    return e.body || `Fehler ${e.status}`;
  }
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

export const api = {
  login: (username: string, password: string) =>
    post<{ user: Account }>('/api/auth/login', { username, password }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  authMe: () => get<{ user: Account }>('/api/auth/me'),
  devices: (signal?: AbortSignal) => get<{ devices: Device[] }>('/api/devices', signal),
};
