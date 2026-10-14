import { ApiError, apiErrorMessage } from '../../api/client';
import type { NewDevice } from '../../types';

/** Local key: tokens are not fleet data, the fleet socket never touches them. */
export const ENROLL_TOKENS_KEY = ['enroll-tokens'] as const;

/** Persons for the picker — shared with the device edit dialog. */
export const PERSON_PICKER_KEY = ['persons', 'picker'] as const;

/** How long an open token still works, as a phrase for the token list. */
export function formatRemaining(expiresAt: number, now: number): string {
  const s = expiresAt - now;
  if (s <= 0) return 'abgelaufen';
  if (s < 3600) return `noch ${Math.max(1, Math.floor(s / 60))} min gültig`;
  if (s < 48 * 3600) return `noch ${Math.floor(s / 3600)} h gültig`;
  return `noch ${Math.floor(s / 86400)} Tage gültig`;
}

/** Limits of CreateDeviceRequest in routers/devices.py, so the phone form
 *  stops where the server would refuse. maxLength counts UTF-16 units and
 *  pydantic counts code points, so the browser is never the laxer of the two. */
export const DEVICE_LIMITS = { hostname: 255, os_version: 200, model: 120, serial: 80, imei: 40, notes: 2000 } as const;

/** Request fields of the enrollment endpoints, named as the forms label them. */
const FIELD_LABELS: Record<string, string> = {
  hostname: 'Bezeichnung',
  os_version: 'Version',
  model: 'Modell',
  serial: 'Seriennummer',
  imei: 'IMEI',
  notes: 'Notiz',
  person_id: 'Person',
  label: 'Besitzer / Bezeichnung',
  ttl_hours: 'Gültigkeit',
};

interface ValidationIssue {
  type?: string;
  loc?: unknown[];
  ctx?: { max_length?: number };
}

/**
 * A 422. The server words some itself ("Person nicht gefunden"); FastAPI's
 * own validation answers with a list of objects, which would otherwise
 * reach the form as "Unbekannter Fehler" — so name the field instead.
 */
function validationText(body: string): string {
  let detail: unknown;
  try {
    detail = (JSON.parse(body) as { detail?: unknown }).detail;
  } catch {
    /* body wasn't JSON */
  }
  if (typeof detail === 'string' && detail) return detail;
  const issue = Array.isArray(detail) ? (detail[0] as ValidationIssue | undefined) : undefined;
  const field = issue?.loc?.at(-1);
  const name = typeof field === 'string' ? FIELD_LABELS[field] : undefined;
  if (!name) return 'Eine Angabe hat ein ungültiges Format.';
  const max = issue?.type === 'string_too_long' ? issue.ctx?.max_length : undefined;
  return max ? `„${name}“ ist zu lang — höchstens ${max} Zeichen.` : `„${name}“ hat ein ungültiges Format.`;
}

/** Errors of the enrollment endpoints. A 403 is explained rather than shown
 *  raw: the dialog is only offered to admins and technicians, so it means a
 *  role changed while the dialog was open. */
export function enrollErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'Geräte hinzufügen dürfen nur Administratoren und Techniker.';
  if (e instanceof ApiError && e.status === 422) return validationText(e.body);
  return apiErrorMessage(e);
}

export const MOBILE_OS_OPTIONS: { id: NewDevice['os']; label: string }[] = [
  { id: 'ios', label: 'iPhone (iOS)' },
  { id: 'ipados', label: 'iPad (iPadOS)' },
  { id: 'android', label: 'Android' },
  { id: 'other', label: 'Sonstiges' },
];
