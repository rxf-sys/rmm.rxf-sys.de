import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { describeLoginFailure } from '../loginError';

const api = (status: number, detail?: unknown) => new ApiError(status, detail === undefined ? '' : JSON.stringify({ detail }));

describe('describeLoginFailure', () => {
  it('recognises the second-factor request however it arrives', () => {
    expect(describeLoginFailure(api(401, 'totp_required'), 'credentials')).toEqual({ kind: 'second-factor' });
    expect(describeLoginFailure(new Error('totp_required'), 'credentials')).toEqual({ kind: 'second-factor' });
  });

  it('blames the credentials on the first step and the code on the second', () => {
    expect(describeLoginFailure(api(401, 'Benutzername oder Passwort falsch'), 'credentials').kind).toBe('credentials');
    expect(describeLoginFailure(api(401, 'Code ungültig'), 'code').kind).toBe('code');
  });

  it('blames the credentials when the server refuses them at the code step', () => {
    // The server checks the password before the code: an account disabled or
    // a password reset between the two steps is not a wrong code.
    expect(describeLoginFailure(api(401, 'Benutzername oder Passwort falsch'), 'code')).toEqual({
      kind: 'credentials',
      message: 'Benutzername oder Passwort wird nicht mehr angenommen. Erneut anmelden.',
    });
  });

  it('separates throttling, an unreachable server and a server fault', () => {
    expect(describeLoginFailure(api(429, 'zu viele Fehlversuche'), 'credentials').kind).toBe('throttled');
    expect(describeLoginFailure(new TypeError('Failed to fetch'), 'credentials').kind).toBe('unreachable');
    expect(describeLoginFailure(api(502), 'code').kind).toBe('unreachable');
    expect(describeLoginFailure(api(500, 'boom'), 'credentials')).toEqual({
      kind: 'other',
      message: 'Der Server hat einen Fehler gemeldet (500). Später erneut versuchen.',
    });
  });

  it('never hands a validation list to the page as text', () => {
    const f = describeLoginFailure(api(422, [{ loc: ['body', 'username'], msg: 'too long' }]), 'credentials');
    expect(f).toEqual({ kind: 'other', message: 'Die Eingabe hat ein ungültiges Format.' });
  });

  it('passes any other server sentence through', () => {
    expect(describeLoginFailure(api(400, 'Konto deaktiviert'), 'credentials')).toEqual({ kind: 'other', message: 'Konto deaktiviert' });
  });
});
