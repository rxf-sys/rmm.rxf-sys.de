import { ApiError, apiErrorMessage } from '../../api/client';
import { qk } from '../../api/queryClient';
import type { NewDevice } from '../../types';

/** Local key: tokens are not fleet data, the fleet socket never touches them. */
export const ENROLL_TOKENS_KEY = ['enroll-tokens'] as const;

/** Persons for the picker: the fleet's list, so a person created or deleted
 *  on the persons page is at once on or off the picker. */
export const PERSON_PICKER_KEY = qk.persons;

/** How long an open token still works, as a phrase for the token list. */
export function formatRemaining(expiresAt: number, now: number): string {
  const s = expiresAt - now;
  if (s <= 0) return 'abgelaufen';
  if (s < 3600) return `noch ${Math.max(1, Math.floor(s / 60))} min gültig`;
  if (s < 48 * 3600) return `noch ${Math.floor(s / 3600)} h gültig`;
  return `noch ${Math.floor(s / 86400)} Tage gültig`;
}

/** Errors of the enrollment endpoints. A 403 is explained rather than shown
 *  raw: the dialog is only offered to admins and technicians, so it means a
 *  role changed while the dialog was open. */
export function enrollErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'Geräte hinzufügen dürfen nur Administratoren und Techniker.';
  return apiErrorMessage(e);
}

export const MOBILE_OS_OPTIONS: { id: NewDevice['os']; label: string }[] = [
  { id: 'ios', label: 'iPhone (iOS)' },
  { id: 'ipados', label: 'iPad (iPadOS)' },
  { id: 'android', label: 'Android' },
  { id: 'other', label: 'Sonstiges' },
];
