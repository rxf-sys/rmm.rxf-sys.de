import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Account } from '../../../types';
import {
  DEFAULT_SORT,
  EMPTY_DRAFT,
  FORBIDDEN_TEXT,
  accountSummary,
  backupCodesFile,
  backupCodesText,
  disableCode,
  draftReady,
  explain,
  formatDate,
  formatSort,
  groupSecret,
  nameTaken,
  nextSort,
  parseSort,
  passwordHint,
  passwordShortfall,
  sortAccounts,
  totpCode,
} from '../accounts';

const acc = (id: number, username: string, over: Partial<Account> = {}): Account => ({
  id,
  username,
  email: null,
  role: 'viewer',
  disabled: false,
  created_at: 0,
  last_login_at: null,
  totp_enabled: false,
  ...over,
});

const list = [
  acc(1, 'bob', { role: 'admin', last_login_at: 300, email: 'b@x.de', totp_enabled: true }),
  acc(2, 'Anna', { role: 'techniker', last_login_at: 100 }),
  acc(3, 'carl', { role: 'viewer', email: 'a@x.de' }),
  acc(4, 'dora', { role: 'admin', last_login_at: 200, disabled: true }),
];
const names = (l: Account[]) => l.map((a) => a.username);

describe('sorting', () => {
  it('reads and writes the URL value, keeping the default out of it', () => {
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort('login-desc')).toEqual({ key: 'login', dir: 'desc' });
    expect(parseSort('role')).toEqual({ key: 'role', dir: 'asc' });
    expect(parseSort('nonsense-desc')).toEqual(DEFAULT_SORT);
    expect(formatSort(DEFAULT_SORT)).toBeNull();
    expect(formatSort({ key: 'mail', dir: 'desc' })).toBe('mail-desc');
  });

  it('flips the direction on the same column and starts the last login newest first', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'login')).toEqual({ key: 'login', dir: 'desc' });
    expect(nextSort({ key: 'login', dir: 'desc' }, 'role')).toEqual({ key: 'role', dir: 'asc' });
  });

  it('sorts names without regard to case', () => {
    expect(names(sortAccounts(list, { key: 'name', dir: 'asc' }))).toEqual(['Anna', 'bob', 'carl', 'dora']);
    expect(names(sortAccounts(list, { key: 'name', dir: 'desc' }))).toEqual(['dora', 'carl', 'bob', 'Anna']);
  });

  it('keeps accounts that never logged in at the bottom in both directions', () => {
    expect(names(sortAccounts(list, { key: 'login', dir: 'desc' }))).toEqual(['bob', 'dora', 'Anna', 'carl']);
    expect(names(sortAccounts(list, { key: 'login', dir: 'asc' }))).toEqual(['Anna', 'dora', 'bob', 'carl']);
  });

  it('orders roles by rights and breaks ties by name', () => {
    expect(names(sortAccounts(list, { key: 'role', dir: 'asc' }))).toEqual(['bob', 'dora', 'Anna', 'carl']);
  });

  it('puts accounts without e-mail last', () => {
    expect(names(sortAccounts(list, { key: 'mail', dir: 'asc' }))).toEqual(['carl', 'bob', 'Anna', 'dora']);
    expect(names(sortAccounts(list, { key: 'mail', dir: 'desc' }))).toEqual(['bob', 'carl', 'Anna', 'dora']);
  });

  it('does not touch the list it was given', () => {
    const copy = [...list];
    sortAccounts(list, { key: 'login', dir: 'desc' });
    expect(list).toEqual(copy);
  });
});

describe('accountSummary', () => {
  it('counts, and names only what needs a look', () => {
    expect(accountSummary([acc(1, 'a', { totp_enabled: true, person_id: 4 })])).toBe('1 Konto');
    // A disabled account without a second factor cannot sign in; no risk.
    expect(accountSummary(list)).toBe('4 Konten · 1 deaktiviert · 2 ohne Zwei-Faktor · 1 Betrachter ohne Person');
  });

  it('counts a viewer without a person as needing a look, unless it cannot sign in', () => {
    const on = { totp_enabled: true };
    expect(accountSummary([acc(1, 'a', { ...on, person_id: 4 })])).toBe('1 Konto');
    expect(accountSummary([acc(1, 'a', on), acc(2, 'b', { ...on, person_id: null })])).toBe('2 Konten · 2 Betrachter ohne Person');
    expect(accountSummary([acc(1, 'a', { ...on, disabled: true })])).toBe('1 Konto · 1 deaktiviert');
    // Only a viewer's sight hangs on the person.
    expect(accountSummary([acc(1, 'a', { ...on, role: 'techniker' })])).toBe('1 Konto');
  });
});

describe('account form', () => {
  it('finds a taken name regardless of case and spaces', () => {
    expect(nameTaken(' ANNA ', list)).toBe(true);
    expect(nameTaken('erik', list)).toBe(false);
    expect(nameTaken('  ', list)).toBe(false);
  });

  it('counts down the missing password characters', () => {
    expect(passwordShortfall('abc')).toBe(5);
    expect(passwordShortfall('abcdefgh')).toBe(0);
    expect(passwordHint('')).toBe('Mindestens 8 Zeichen.');
    expect(passwordHint('abc')).toBe('Mindestens 8 Zeichen — noch 5.');
    expect(passwordHint('abcdefghij')).toBe('Mindestens 8 Zeichen.');
  });

  it('counts characters as the server does, not UTF-16 units', () => {
    // Four emoji are eight UTF-16 units but four characters for pydantic's min_length.
    const four = '😀😀😀😀';
    expect(passwordShortfall(four)).toBe(4);
    expect(passwordHint(four)).toBe('Mindestens 8 Zeichen — noch 4.');
    expect(passwordShortfall(four + four)).toBe(0);
    expect(draftReady({ ...EMPTY_DRAFT, username: 'erik', password: four }, list)).toBe(false);
  });

  it('is ready with a free name and a long enough password', () => {
    const tech = { ...EMPTY_DRAFT, role: 'techniker' as const };
    expect(draftReady(tech, list)).toBe(false);
    expect(draftReady({ ...tech, username: 'erik', password: 'geheim123' }, list)).toBe(true);
    expect(draftReady({ ...tech, username: 'anna', password: 'geheim123' }, list)).toBe(false);
    expect(draftReady({ ...tech, username: 'erik', password: 'kurz' }, list)).toBe(false);
  });

  it('makes a viewer ready only together with its person', () => {
    // Without one the server scopes it to nothing: an account that sees no device.
    const viewer = { ...EMPTY_DRAFT, username: 'erik', password: 'geheim123' };
    expect(viewer.role).toBe('viewer');
    expect(viewer.personId).toBeNull();
    expect(draftReady(viewer, list)).toBe(false);
    expect(draftReady({ ...viewer, personId: 7 }, list)).toBe(true);
    expect(draftReady({ ...viewer, role: 'techniker' }, list)).toBe(true);
  });
});

describe('two-factor helpers', () => {
  it('keeps six digits of whatever was pasted', () => {
    expect(totpCode('123 456')).toBe('123456');
    expect(totpCode('12-34-56-78')).toBe('123456');
    expect(disableCode('  1a2b-3c4d  ')).toBe('1a2b-3c4d');
  });

  it('groups the secret in blocks of four', () => {
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    expect(groupSecret('')).toBe('');
  });

  it('writes the backup codes as a file worth keeping', () => {
    const ts = new Date(2026, 9, 11, 12).getTime() / 1000;
    expect(formatDate(ts)).toBe('11.10.2026');
    const text = backupCodesText('anna', ['1111-2222', '3333-4444'], ts);
    expect(text).toContain('Backup-Codes für anna');
    expect(text).toContain('Ausgestellt am 11.10.2026');
    expect(text).toContain('1111-2222\n3333-4444');
    expect(backupCodesFile('Anna Müller/2')).toBe('vulpexa-backup-codes-Anna_M_ller_2.txt');
    expect(backupCodesFile('///')).toBe('vulpexa-backup-codes-konto.txt');
  });
});

describe('explain', () => {
  it('explains a 403 and leaves every other error alone', () => {
    const forbidden = explain(new ApiError(403, '{"detail":"admin privileges required"}'));
    expect(forbidden).toBeInstanceOf(Error);
    expect((forbidden as Error).message).toBe(FORBIDDEN_TEXT);
    const conflict = new ApiError(409, '{"detail":"Benutzername existiert bereits"}');
    expect(explain(conflict)).toBe(conflict);
  });
});
