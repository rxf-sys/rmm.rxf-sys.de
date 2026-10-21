/** MDM answers for tests: everything empty, override what the test is about. */
import type { DeviceMdm, MdmBinding } from '../types';

export function mdmBinding(over: Partial<MdmBinding> = {}): MdmBinding {
  return {
    udid: '00008110-000A',
    enrollment_id: 1,
    access_rights: 8191,
    enrolled_at: 1_790_000_000,
    last_seen_at: 1_790_000_000,
    checked_out_at: null,
    info: {},
    info_at: null,
    security: {},
    security_at: null,
    apps: [],
    apps_at: null,
    profiles: [],
    profiles_at: null,
    certificates: [],
    certificates_at: null,
    refresh_at: null,
    unlock_token: false,
    unlock_token_at: null,
    identity_issued_at: null,
    identity_expires_at: null,
    renewal: { started_at: null, scep_at: null, done_at: null, error: '' },
    ...over,
  };
}

export function deviceMdm(over: Partial<DeviceMdm> = {}): DeviceMdm {
  return {
    configured: true,
    missing: [],
    enrollment: null,
    binding: null,
    needs_reenroll: false,
    permissions: ['lock', 'erase', 'clear_passcode', 'apps'],
    denied: [],
    actions: { refresh: null, lock: null, erase: null, clear_passcode: null, renew: null },
    commands: [],
    ...over,
  };
}
