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

export interface Device {
  id: number;
  hostname: string;
  owner_label: string;
  os: string;
  os_version: string;
  arch: string;
  agent_version: string;
  tags: string[];
  created_at: number;
  last_seen_at: number | null;
  online: boolean;
}
