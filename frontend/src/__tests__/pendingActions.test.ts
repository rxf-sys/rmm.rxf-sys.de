import { describe, expect, it } from 'vitest';
import { actionOrigin, actionTitle, isOpen } from '../pendingActions';
import type { PendingAction } from '../types';

const action = (over: Partial<PendingAction> = {}): PendingAction => ({
  id: 1,
  device_id: 2,
  kind: 'patch_install',
  security_only: false,
  script_id: null,
  reboot: false,
  source: 'manual',
  created_by: 'robin',
  created_at: 0,
  expires_at: null,
  state: 'pending',
  job_id: null,
  job_status: null,
  updated_at: 0,
  note: '',
  ...over,
});

describe('pendingActions', () => {
  const names = (id: number) => (id === 7 ? 'Uptime' : undefined);

  it('names what an action does', () => {
    expect(actionTitle(action(), names)).toBe('Alle Updates installieren');
    expect(actionTitle(action({ security_only: true, reboot: true }), names)).toBe(
      'Sicherheitsupdates installieren, danach Neustart falls nötig',
    );
    expect(actionTitle(action({ kind: 'script', script_id: 7 }), names)).toBe('Skript „Uptime“ ausführen');
    expect(actionTitle(action({ kind: 'script', script_id: 9 }), names)).toBe('Skript ausführen');
    expect(actionTitle(action({ kind: 'reboot' }), names)).toBe('Neustart, falls das System ihn verlangt');
  });

  it('says who asked for it and whether it is still open', () => {
    expect(actionOrigin(action())).toBe('robin');
    expect(actionOrigin(action({ source: 'patch_window' }))).toBe('Patch-Fenster, nachgeholt');
    expect(actionOrigin(action({ source: 'follow_up' }))).toBe('nach der Installation');
    expect(isOpen(action())).toBe(true);
    expect(isOpen(action({ state: 'dispatched' }))).toBe(true);
    expect(isOpen(action({ state: 'expired' }))).toBe(false);
  });
});
