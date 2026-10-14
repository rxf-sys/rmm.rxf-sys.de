import { ApiError, apiErrorMessage } from '../../api/client';

/** The server's way of saying "password accepted, now the code"
 *  (backend/app/routers/auth.py). It arrives as a 401 detail. */
export const TOTP_REQUIRED = 'totp_required';

/** The server's only way of saying "wrong code" (backend/app/routers/auth.py),
 *  for app and backup codes alike. Every other 401 there means the password
 *  check, which runs before the code, refused the sign-in. */
export const CODE_REJECTED = 'Code ungültig';

export type LoginStep = 'credentials' | 'code';

/** A failed sign-in, sorted by what the form should do about it. */
export type LoginFailure =
  | { kind: 'second-factor' }
  | { kind: 'credentials' | 'code' | 'throttled' | 'unreachable' | 'other'; message: string };

/** A proxy answers these when the backend behind it is gone. */
const GATEWAY_DOWN = new Set([502, 503, 504]);

/**
 * Turn whatever `onLogin` threw into one sentence and a kind.
 *
 * The raw server details ("zu viele Fehlversuche — …", "Code ungültig") are
 * terse and lower-case; the page says what happened and what to do next.
 */
export function describeLoginFailure(err: unknown, step: LoginStep): LoginFailure {
  const detail = apiErrorMessage(err);
  if (detail === TOTP_REQUIRED) return { kind: 'second-factor' };
  if (err instanceof TypeError || (err instanceof ApiError && GATEWAY_DOWN.has(err.status))) {
    return { kind: 'unreachable', message: 'Server nicht erreichbar — Netzwerk prüfen und erneut versuchen.' };
  }
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return {
        kind: 'throttled',
        message: 'Zu viele Fehlversuche von dieser Adresse. Die Anmeldung ist für einige Minuten gesperrt.',
      };
    }
    if (err.status === 401) {
      if (step === 'credentials') return { kind: 'credentials', message: 'Benutzername oder Passwort stimmt nicht.' };
      if (detail === CODE_REJECTED) {
        return { kind: 'code', message: 'Der Code stimmt nicht. Einen neuen Code aus der App nehmen oder einen Backup-Code verwenden.' };
      }
      // The password was accepted a step ago and is refused now: reset or
      // account disabled in between. Another code would only count as one
      // more failure towards the throttle.
      return { kind: 'credentials', message: 'Benutzername oder Passwort wird nicht mehr angenommen. Erneut anmelden.' };
    }
    // FastAPI's validation detail is a list of objects, not a sentence.
    if (err.status === 422) return { kind: 'other', message: 'Die Eingabe hat ein ungültiges Format.' };
    if (err.status >= 500) {
      return { kind: 'other', message: `Der Server hat einen Fehler gemeldet (${err.status}). Später erneut versuchen.` };
    }
  }
  return { kind: 'other', message: typeof detail === 'string' && detail ? detail : 'Anmeldung fehlgeschlagen.' };
}
