import { describe, expect, it } from 'vitest';
import type { Account } from '../../../types';
import { deleteText, disableText, resetTotpText, roleChangeText } from '../confirmations';

const acc = (over: Partial<Account> = {}): Account => ({
  id: 2,
  username: 'anna',
  email: null,
  role: 'techniker',
  disabled: false,
  created_at: 0,
  last_login_at: null,
  ...over,
});

describe('roleChangeText', () => {
  it('asks before granting admin rights', () => {
    const t = roleChangeText(acc(), 'admin');
    expect(t?.title).toBe('„anna“ zum Administrator machen?');
    expect(t?.danger).toBeUndefined();
  });

  it('asks before taking them away, naming the new role', () => {
    const t = roleChangeText(acc({ role: 'admin' }), 'viewer');
    expect(t?.title).toBe('„anna“ herabstufen?');
    expect(t?.body).toContain('wird Betrachter');
    expect(t?.confirmLabel).toBe('Zum Betrachter machen');
    expect(t?.danger).toBe(true);
  });

  it('lets moves between viewer and technician through, and no-ops', () => {
    expect(roleChangeText(acc({ person_id: 4 }), 'viewer')).toBeNull();
    expect(roleChangeText(acc({ role: 'viewer' }), 'techniker')).toBeNull();
    expect(roleChangeText(acc(), 'techniker')).toBeNull();
  });

  it('asks before making a viewer of an account that has no person to see', () => {
    const t = roleChangeText(acc(), 'viewer');
    expect(t?.title).toBe('„anna“ zum Betrachter machen?');
    expect(t?.body).toContain('sieht danach keine Geräte');
    expect(t?.body).toContain('Person zuordnen');
    expect(t?.confirmLabel).toBe('Zum Betrachter machen');
    // A demoted admin hears it too, on top of what it loses.
    expect(roleChangeText(acc({ role: 'admin' }), 'viewer')?.body).toContain('sieht danach keine Geräte');
    expect(roleChangeText(acc({ role: 'admin', person_id: 4 }), 'viewer')?.body).not.toContain('keine Geräte');
  });
});

describe('destructive steps', () => {
  it('name the account', () => {
    for (const t of [resetTotpText(acc(), false), disableText(acc()), deleteText(acc())]) {
      expect(t.title).toContain('„anna“');
      expect(t.danger).toBe(true);
    }
  });

  it('make the name typed before deleting', () => {
    expect(deleteText(acc()).requireText).toBe('anna');
    expect(disableText(acc()).requireText).toBeUndefined();
  });

  it('say when the own second factor is reset', () => {
    expect(resetTotpText(acc(), true).body).toContain('deines eigenen Kontos');
    expect(resetTotpText(acc(), false).body).toContain('verlorenes Telefon');
  });
});
