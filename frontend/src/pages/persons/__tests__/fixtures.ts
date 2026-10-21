import type { Account, Alert, AuditEvent, Device, Person } from '../../../types';

export function person(over: Partial<Person> = {}): Person {
  return {
    id: 2,
    name: 'Martina Fuchs',
    email: 'martina@example.de',
    phone: '+49 170 0000000',
    notes: 'Ruft bei Problemen abends an.',
    created_at: 0,
    device_count: 1,
    ...over,
  };
}

export function device(over: Partial<Device> = {}): Device {
  return {
    id: 11,
    hostname: 'laptop-mama',
    owner_label: '',
    os: 'windows',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.3.9',
    tags: [],
    heartbeat: {},
    rustdesk_id: '',
    person_id: 2,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
    online: false,
    connected: false,
    agent_update_available: null,
    last_patch_scan_at: 0,
    device_class: 'agent',
    ownership: '',
    model: '',
    serial: '',
    imei: '',
    notes: '',
    checked_at: null,
    ...over,
  };
}

export function account(over: Partial<Account> = {}): Account {
  return {
    id: 5,
    username: 'martina',
    email: null,
    role: 'viewer',
    disabled: false,
    created_at: 1_700_000_000,
    last_login_at: null,
    totp_enabled: false,
    person_id: 2,
    ...over,
  };
}

export function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    device_id: 11,
    rule: 'offline',
    message: 'Gerät offline',
    fired_at: 0,
    resolved_at: null,
    notified: true,
    acked_at: null,
    acked_by: '',
    ...over,
  };
}

export function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 1,
    ts: 1_700_000_000,
    event: 'auth.login',
    actor: 'martina',
    device_id: null,
    detail: {},
    category: 'auth',
    security: false,
    ...over,
  };
}
