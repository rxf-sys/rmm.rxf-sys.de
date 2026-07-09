import type {
  Account,
  Alert,
  AlertRule,
  AuditEvent,
  AutomationConfig,
  Credential,
  CreatedEnrollToken,
  Device,
  DeviceDetail,
  EnrollToken,
  Job,
  MetricSample,
  Patch,
  PatchSummary,
  PatchWindow,
  Person,
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
  updateDevice: (
    id: number,
    body: { owner_label?: string; tags?: string[]; rustdesk_id?: string; person_id?: number },
  ) => patch<{ device: Device }>(`/api/devices/${id}`, body),

  // Persons
  persons: (signal?: AbortSignal) => get<{ persons: Person[] }>('/api/persons', signal),
  createPerson: (body: { name: string; email?: string; phone?: string; notes?: string }) =>
    post<{ person: Person }>('/api/persons', body),
  updatePerson: (id: number, body: { name: string; email?: string; phone?: string; notes?: string }) =>
    send<{ person: Person }>('PUT', `/api/persons/${id}`, body),
  deletePerson: (id: number) => del<{ ok: boolean }>(`/api/persons/${id}`),

  // Credentials (admin-only; secrets only via reveal)
  credentials: (deviceId: number, signal?: AbortSignal) =>
    get<{ credentials: Credential[] }>(`/api/devices/${deviceId}/credentials`, signal),
  createCredential: (
    deviceId: number,
    body: { label: string; username?: string; secret: string; notes?: string },
  ) => post<{ credential: Credential }>(`/api/devices/${deviceId}/credentials`, body),
  updateCredential: (
    deviceId: number,
    credId: number,
    body: { label: string; username?: string; secret?: string; notes?: string },
  ) => send<{ credential: Credential }>('PUT', `/api/devices/${deviceId}/credentials/${credId}`, body),
  revealCredential: (deviceId: number, credId: number) =>
    post<{ secret: string }>(`/api/devices/${deviceId}/credentials/${credId}/reveal`),
  deleteCredential: (deviceId: number, credId: number) =>
    del<{ ok: boolean }>(`/api/devices/${deviceId}/credentials/${credId}`),

  // Accounts (admin panel)
  accounts: (signal?: AbortSignal) => get<{ accounts: Account[] }>('/api/accounts', signal),
  createAccount: (body: { username: string; password: string; role: string; email?: string }) =>
    post<{ account: Account }>('/api/accounts', body),
  updateAccount: (
    id: number,
    body: { role?: string; disabled?: boolean; password?: string; email?: string },
  ) => patch<{ account: Account }>(`/api/accounts/${id}`, body),
  deleteAccount: (id: number) => del<{ ok: boolean }>(`/api/accounts/${id}`),
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
  updateAutomation: (body: { patch_window: PatchWindow }) =>
    send<AutomationConfig>('PUT', '/api/automation', body),
  createRule: (body: {
    type: string;
    enabled?: boolean;
    threshold?: number | null;
    scope_kind?: string;
    scope_value?: string;
  }) => post<{ rule: AlertRule }>('/api/automation/rules', body),
  updateRule: (
    id: number,
    body: {
      type: string;
      enabled: boolean;
      threshold: number | null;
      scope_kind: string;
      scope_value: string;
    },
  ) => send<{ rule: AlertRule }>('PUT', `/api/automation/rules/${id}`, body),
  deleteRule: (id: number) => del<{ ok: boolean }>(`/api/automation/rules/${id}`),

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
