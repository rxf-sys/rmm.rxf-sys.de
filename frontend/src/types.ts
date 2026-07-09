export type Role = 'admin' | 'viewer';

export interface Account {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  disabled: boolean;
  created_at: number;
  last_login_at: number | null;
}

export interface Heartbeat {
  ts?: number;
  agent_version?: string;
  cpu_pct?: number;
  mem_pct?: number;
  disks?: { mount: string; used_pct: number; total_b: number }[];
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
  created_at: number;
  last_seen_at: number | null;
  online: boolean;
  /** Live WebSocket open right now (raw signal behind `online`). */
  connected: boolean;
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

export interface AutomationConfig {
  rules: AlertRule[];
  patch_window: PatchWindow;
  patch_window_last_run: number | null;
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

export interface Script {
  id: number;
  name: string;
  shell: Shell;
  content: string;
  updated_by: string;
  updated_at: number;
}

export interface AuditEvent {
  id: number;
  ts: number;
  event: string;
  actor: string;
  device_id: number | null;
  detail: Record<string, unknown>;
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
