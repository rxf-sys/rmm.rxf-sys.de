import type {
  Account,
  CreatedEnrollToken,
  Device,
  DeviceDetail,
  EnrollToken,
} from '../types';

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

async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(path, {
    method,
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

const post = <T>(path: string, body?: unknown) => send<T>('POST', path, body);
const patch = <T>(path: string, body?: unknown) => send<T>('PATCH', path, body);
const del = <T>(path: string) => send<T>('DELETE', path);

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
  device: (id: number, signal?: AbortSignal) =>
    get<DeviceDetail>(`/api/devices/${id}`, signal),
  updateDevice: (id: number, body: { owner_label?: string; tags?: string[] }) =>
    patch<{ device: Device }>(`/api/devices/${id}`, body),
  deleteDevice: (id: number) => del<{ ok: boolean }>(`/api/devices/${id}`),

  enrollTokens: (signal?: AbortSignal) =>
    get<{ tokens: EnrollToken[] }>('/api/devices/enroll-tokens', signal),
  createEnrollToken: (body: { label?: string; ttl_hours?: number }) =>
    post<CreatedEnrollToken>('/api/devices/enroll-tokens', body),
  deleteEnrollToken: (id: number) => del<{ ok: boolean }>(`/api/devices/enroll-tokens/${id}`),
};
