export type Role = 'admin' | 'techniker' | 'viewer';

export interface Account {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  disabled: boolean;
  created_at: number;
  last_login_at: number | null;
  totp_enabled?: boolean;
  /** Verknüpfte Person — Betrachter sehen nur deren Geräte. */
  person_id?: number | null;
}

export interface Heartbeat {
  ts?: number;
  agent_version?: string;
  cpu_pct?: number;
  mem_pct?: number;
  mem_used_b?: number;
  mem_total_b?: number;
  disks?: { mount: string; used_pct: number; used_b?: number; total_b: number }[];
  /** Netzwerk-Durchsatz (Bytes/s, alle Nicht-Loopback-Interfaces); fehlt bei
   * älteren Agents. */
  net_rx_bps?: number;
  net_tx_bps?: number;
  /** Kumulierte Zähler seit Boot. */
  net_rx_total_b?: number;
  net_tx_total_b?: number;
  /** Best-effort-Extras — fehlen, wenn das System sie nicht liefert. */
  cpu_temp_c?: number;
  battery_pct?: number;
  battery_state?: string; // charging|discharging|full|ac
  logged_in_user?: string;
  reboot_required?: boolean;
}

export interface Device {
  id: number;
  hostname: string;
  owner_label: string;
  os: string;
  os_version: string;
  arch: string;
  agent_version: string;
  tags: string[];
  heartbeat: Heartbeat;
  rustdesk_id: string;
  person_id: number | null;
  /** Unix ts while an alert-suppression window is open, else null. */
  maintenance_until: number | null;
  created_at: number;
  last_seen_at: number | null;
  online: boolean;
  /** Live WebSocket open right now (raw signal behind `online`). */
  connected: boolean;
  /** Version of a newer signed agent release on the server, else null. */
  agent_update_available: string | null;
  /** Letzter eingetroffener Update-Scan; 0 = noch nie. */
  last_patch_scan_at: number;
}

export interface Person {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  created_at: number;
  device_count: number;
}

export interface Credential {
  id: number;
  device_id: number;
  label: string;
  username: string;
  notes: string;
  updated_by: string;
  updated_at: number;
}

export interface RemoteConfig {
  enabled: boolean;
  relay_host: string;
  has_key: boolean;
  deploy_commands: Partial<Record<'windows' | 'linux' | 'darwin', string>>;
}

export interface InventorySection {
  data: unknown;
  updated_at: number;
}

export interface DeviceDetail {
  device: Device;
  inventory: {
    hardware?: InventorySection;
    software?: InventorySection;
  };
}

export interface MetricSample {
  ts: number;
  cpu_pct: number;
  mem_pct: number;
  disk_max_pct: number;
}

export interface Alert {
  id: number;
  device_id: number;
  rule: 'offline' | 'disk' | string;
  message: string;
  fired_at: number;
  resolved_at: number | null;
  notified: boolean;
  acked_at: number | null;
  acked_by: string;
}

export type RuleType = 'offline' | 'disk' | 'patch_age';
export type ScopeKind = 'all' | 'tag' | 'person';

export interface AlertRule {
  id: number;
  type: RuleType;
  enabled: boolean;
  /** null = server default (offline: Sekunden, disk: %, patch_age: Tage). */
  threshold: number | null;
  scope_kind: ScopeKind;
  scope_value: string;
  created_at: number;
}

export interface PatchWindow {
  enabled: boolean;
  /** 0 = Montag … 6 = Sonntag (matches Python's tm_wday). */
  weekday: number;
  hour: number;
  security_only: boolean;
  /** Empty tag = every device. */
  tag: string;
}

export interface ScriptSchedule {
  id: number;
  script_id: number;
  enabled: boolean;
  /** 0-6, or null = every day. */
  weekday: number | null;
  hour: number;
  scope_kind: ScopeKind;
  scope_value: string;
  last_run: number | null;
  created_at: number;
}

export interface AutomationConfig {
  rules: AlertRule[];
  schedules: ScriptSchedule[];
  patch_window: PatchWindow;
  patch_window_last_run: number | null;
  /** Täglicher Update-Scan — steht in der Serverkonfiguration
   *  (`PATCH_SCAN_ENABLED`/`PATCH_SCAN_HOUR`) und ist hier nur ablesbar. */
  patch_scan: { enabled: boolean; hour: number };
}

export interface NtfyConfig {
  base: string;
  topic: string;
  has_token: boolean;
  source: 'ui' | 'env' | 'none';
}

export interface SessionInfo {
  token_prefix: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  current: boolean;
}

export interface AlertStats {
  days: number;
  by_rule: Record<string, number>;
  total: number;
  open: number;
}

export interface InventoryMatch {
  device_id: number;
  hostname: string;
  name: string;
  version: string;
}

export interface EnrollToken {
  id: number;
  label: string;
  created_at: number;
  expires_at: number;
}

export interface CreatedEnrollToken extends EnrollToken {
  /** The raw token — shown exactly once, never retrievable again. */
  token: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout';

export interface Job {
  id: number;
  device_id: number;
  kind: 'shell' | 'script' | 'patch_install';
  command: string;
  shell: string;
  script_id: number | null;
  script_name: string;
  status: JobStatus;
  exit_code: number | null;
  created_by: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  /** Present on the detail endpoint, omitted from the list endpoint. */
  output?: string;
}

export type Shell = 'bash' | 'zsh' | 'powershell';

export type ScriptOs = 'windows' | 'linux' | 'darwin' | 'any';

export type ScriptCategory = 'wartung' | 'sicherheit' | 'diagnose' | 'sonstiges';

export interface Script {
  id: number;
  name: string;
  shell: Shell;
  os: ScriptOs;
  content: string;
  category: ScriptCategory;
  /** Destroys data or can take a device down — the UI asks for the script
   *  name to be typed before it runs. */
  danger: boolean;
  updated_by: string;
  updated_at: number;
}

export type AuditCategory =
  | 'auth'
  | 'account'
  | 'device'
  | 'job'
  | 'patch'
  | 'remote'
  | 'alert'
  | 'script'
  | 'person'
  | 'credential'
  | 'config'
  | 'other';

export interface AuditEvent {
  id: number;
  ts: number;
  event: string;
  actor: string;
  device_id: number | null;
  detail: Record<string, unknown>;
  /** Classified server-side, so the colour here and the filter there agree. */
  category: AuditCategory;
  /** Part of the "Sicherheit" quick filter. */
  security: boolean;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
}

export type Severity = 'critical' | 'important' | 'moderate' | 'low' | 'other';

export interface Patch {
  patch_id: string;
  title: string;
  severity: Severity;
  detected_at: number;
  updated_at: number;
}

/** Per-device patch counts, keyed by device id (as string from JSON). */
export type PatchSummary = Record<string, { pending: number; security: number }>;

/** Ein Stundenbucket der Flottenlast (`GET /api/fleet/metrics`). */
export interface FleetSample {
  ts: number;
  cpu_avg: number;
  mem_avg: number;
  disk_max: number;
  samples: number;
  /** Wie viele Geräte in dieser Stunde überhaupt gemeldet haben. */
  devices: number;
}
