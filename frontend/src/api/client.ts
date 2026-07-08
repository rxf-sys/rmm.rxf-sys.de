import type {
  Account,
  Alert,
  AuditEvent,
  AutomationConfig,
  AutomationRules,
  CreatedEnrollToken,
  Device,
  DeviceDetail,
  EnrollToken,
  Job,
  MetricSample,
  Patch,
  PatchSummary,
  PatchWindow,
  RemoteConfig,
  Script,
  Shell,
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
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  deviceHistory: (id: number, hours: number, signal?: AbortSignal) =>
    get<{ samples: MetricSample[] }>(`/api/devices/${id}/history?hours=${hours}`, signal),
  alerts: (signal?: AbortSignal) => get<{ alerts: Alert[] }>('/api/alerts', signal),
  ackAlert: (id: number) => post<{ alert: Alert }>(`/api/alerts/${id}/ack`),
  updateDevice: (id: number, body: { owner_label?: string; tags?: string[]; rustdesk_id?: string }) =>
    patch<{ device: Device }>(`/api/devices/${id}`, body),
  deleteDevice: (id: number) => del<{ ok: boolean }>(`/api/devices/${id}`),

  enrollTokens: (signal?: AbortSignal) =>
    get<{ tokens: EnrollToken[] }>('/api/devices/enroll-tokens', signal),
  createEnrollToken: (body: { label?: string; ttl_hours?: number }) =>
    post<CreatedEnrollToken>('/api/devices/enroll-tokens', body),
  deleteEnrollToken: (id: number) => del<{ ok: boolean }>(`/api/devices/enroll-tokens/${id}`),

  // Jobs
  deviceJobs: (deviceId: number, signal?: AbortSignal) =>
    get<{ jobs: Job[] }>(`/api/devices/${deviceId}/jobs`, signal),
  job: (jobId: number, signal?: AbortSignal) => get<{ job: Job }>(`/api/jobs/${jobId}`, signal),
  createShellJob: (deviceId: number, command: string, shell: Shell) =>
    post<{ job: Job }>(`/api/devices/${deviceId}/jobs`, { kind: 'shell', command, shell }),
  createScriptJob: (deviceId: number, scriptId: number) =>
    post<{ job: Job }>(`/api/devices/${deviceId}/jobs`, { kind: 'script', script_id: scriptId }),

  // Scripts
  scripts: (signal?: AbortSignal) => get<{ scripts: Script[] }>('/api/scripts', signal),
  createScript: (body: { name: string; shell: Shell; content: string }) =>
    post<{ script: Script }>('/api/scripts', body),
  updateScript: (id: number, body: { name: string; shell: Shell; content: string }) =>
    send<{ script: Script }>('PUT', `/api/scripts/${id}`, body),
  deleteScript: (id: number) => del<{ ok: boolean }>(`/api/scripts/${id}`),

  // Audit
  audit: (limit = 100, signal?: AbortSignal) =>
    get<{ events: AuditEvent[] }>(`/api/audit?limit=${limit}`, signal),

  // Patches
  patchSummary: (signal?: AbortSignal) =>
    get<{ summary: PatchSummary }>('/api/patches/summary', signal),
  devicePatches: (deviceId: number, signal?: AbortSignal) =>
    get<{ patches: Patch[]; installing_job: number | null }>(
      `/api/devices/${deviceId}/patches`,
      signal,
    ),
  scanPatches: (deviceId: number) => post<{ ok: boolean }>(`/api/devices/${deviceId}/patches/scan`),
  installPatches: (deviceId: number, body: { patch_ids?: string[]; security_only?: boolean }) =>
    post<{ job: Job }>(`/api/devices/${deviceId}/patches/install`, body),

  // Automation
  automation: (signal?: AbortSignal) => get<AutomationConfig>('/api/automation', signal),
  updateAutomation: (body: { rules: AutomationRules; patch_window: PatchWindow }) =>
    send<AutomationConfig>('PUT', '/api/automation', body),

  // Remote desktop
  remoteConfig: (signal?: AbortSignal) => get<RemoteConfig>('/api/remote/config', signal),
  remoteSession: (deviceId: number) =>
    get<{ rustdesk_id: string; deep_link: string }>(`/api/remote/devices/${deviceId}/session`),
};

/** Open the live-output WebSocket for a job. Returns the socket; the caller
 * wires up onmessage/onclose. Uses the page origin so it rides the same
 * Cloudflare tunnel as the REST API. */
export function openJobSocket(jobId: number): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${proto}//${window.location.host}/api/jobs/${jobId}/ws`);
}
