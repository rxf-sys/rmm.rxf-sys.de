import type {
  Account,
  Alert,
  AlertRule,
  AuditPage,
  AutomationConfig,
  Credential,
  CreatedEnrollToken,
  Device,
  DeviceDetail,
  EnrollToken,
  Job,
  MetricSample,
  AlertStats,
  InventoryMatch,
  NtfyConfig,
  Patch,
  PatchSummary,
  PatchWindow,
  Person,
  RemoteConfig,
  Script,
  ScriptSchedule,
  SessionInfo,
  Shell,
} from '../types';

/** Filters accepted by GET /api/audit. Everything is optional; an empty
 *  object is "the most recent 100 events". */
export interface AuditQuery {
  limit?: number;
  offset?: number;
  deviceId?: number;
  actor?: string;
  category?: string;
  securityOnly?: boolean;
  /** Unix seconds — the client decides what "last 24h" means. */
  since?: number;
  q?: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`);
  }
}

/**
 * Fired once per 401 so the app can send the user back to the login page.
 *
 * Without it an expired session turned every screen into a permanent error
 * banner: the pollers kept running, kept getting 401, and nothing ever
 * concluded "you are logged out". `useAuth` listens for this.
 */
export const UNAUTHORIZED_EVENT = 'rmm:unauthorized';

async function fail(r: Response): Promise<never> {
  const text = await r.text().catch(() => '');
  if (r.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  throw new ApiError(r.status, text);
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { credentials: 'include', signal });
  if (!r.ok) return fail(r);
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
  if (!r.ok) return fail(r);
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
  login: (username: string, password: string, totpCode?: string) =>
    post<{ user: Account }>('/api/auth/login', {
      username,
      password,
      ...(totpCode ? { totp_code: totpCode } : {}),
    }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  authMe: () => get<{ user: Account }>('/api/auth/me'),

  // Two-factor (TOTP)
  totpSetup: () => post<{ secret: string; otpauth_uri: string }>('/api/auth/totp/setup'),
  totpConfirm: (secret: string, code: string) =>
    post<{ ok: boolean; backup_codes: string[] }>('/api/auth/totp/confirm', { secret, code }),
  totpDisable: (code: string) => post<{ ok: boolean }>('/api/auth/totp/disable', { code }),

  // Sessions
  sessions: (signal?: AbortSignal) =>
    get<{ sessions: SessionInfo[] }>('/api/auth/sessions', signal),
  revokeSession: (prefix: string) => del<{ ok: boolean }>(`/api/auth/sessions/${prefix}`),
  revokeOtherSessions: () => post<{ ok: boolean; revoked: number }>('/api/auth/sessions/revoke-others'),

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
  wakeDevice: (id: number) => post<{ ok: boolean; sent: number }>(`/api/devices/${id}/wake`),
  updateAgent: (id: number) => post<{ ok: boolean; version: string }>(`/api/devices/${id}/update-agent`),
  setMaintenance: (id: number, minutes: number) =>
    post<{ device: Device }>(`/api/devices/${id}/maintenance`, { minutes }),
  deviceAlerts: (id: number, signal?: AbortSignal) =>
    get<{ alerts: Alert[]; stats: AlertStats }>(`/api/devices/${id}/alerts`, signal),
  agentLogs: (id: number) => get<{ lines: string[] }>(`/api/devices/${id}/agent-logs`),

  // Fleet-wide inventory search
  searchInventory: (q: string, signal?: AbortSignal) =>
    get<{ results: InventoryMatch[] }>(`/api/inventory/search?q=${encodeURIComponent(q)}`, signal),

  // ntfy settings (admin)
  ntfyConfig: (signal?: AbortSignal) => get<NtfyConfig>('/api/settings/ntfy', signal),
  updateNtfy: (body: { base: string; topic: string; token?: string | null }) =>
    send<NtfyConfig>('PUT', '/api/settings/ntfy', body),
  testNtfy: () => post<{ ok: boolean }>('/api/settings/ntfy/test'),

  // Persons
  persons: (signal?: AbortSignal) => get<{ persons: Person[] }>('/api/persons', signal),
  createPerson: (body: { name: string; email?: string; phone?: string; notes?: string }) =>
    post<{ person: Person; account: Account | null; initial_password: string }>(
      '/api/persons',
      body,
    ),
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
    body: { role?: string; disabled?: boolean; password?: string; email?: string; reset_totp?: boolean },
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
  createScript: (body: {
    name: string;
    shell: Shell;
    os: string;
    content: string;
    category: string;
    danger: boolean;
  }) =>
    post<{ script: Script }>('/api/scripts', body),
  updateScript: (
    id: number,
    body: {
      name: string;
      shell: Shell;
      os: string;
      content: string;
      category: string;
      danger: boolean;
    },
  ) =>
    send<{ script: Script }>('PUT', `/api/scripts/${id}`, body),
  deleteScript: (id: number) => del<{ ok: boolean }>(`/api/scripts/${id}`),

  // Audit
  audit: (params: AuditQuery = {}, signal?: AbortSignal) => {
    const qs = new URLSearchParams();
    qs.set('limit', String(params.limit ?? 100));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.deviceId !== undefined) qs.set('device_id', String(params.deviceId));
    if (params.actor) qs.set('actor', params.actor);
    if (params.category) qs.set('category', params.category);
    if (params.securityOnly) qs.set('security_only', 'true');
    if (params.since !== undefined) qs.set('since', String(params.since));
    if (params.q) qs.set('q', params.q);
    return get<AuditPage>(`/api/audit?${qs.toString()}`, signal);
  },
  auditMeta: (signal?: AbortSignal) =>
    get<{ categories: string[]; actors: string[] }>('/api/audit/meta', signal),

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
  createSchedule: (body: {
    script_id: number;
    enabled?: boolean;
    weekday?: number | null;
    hour?: number;
    scope_kind?: string;
    scope_value?: string;
  }) => post<{ schedule: ScriptSchedule }>('/api/automation/schedules', body),
  updateSchedule: (
    id: number,
    body: {
      script_id: number;
      enabled: boolean;
      weekday: number | null;
      hour: number;
      scope_kind: string;
      scope_value: string;
    },
  ) => send<{ schedule: ScriptSchedule }>('PUT', `/api/automation/schedules/${id}`, body),
  deleteSchedule: (id: number) => del<{ ok: boolean }>(`/api/automation/schedules/${id}`),

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

/** Open the fleet-event socket. The server pushes `{type:'refresh'}` hints;
 * the caller re-reads the REST endpoints. */
export function openFleetSocket(): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${proto}//${window.location.host}/api/fleet/ws`);
}
