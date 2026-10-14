import { ApiError } from '../../api/client';
import { qk } from '../../api/queryClient';
import type { Account, Role } from '../../types';

/** Query keys of this page. Not under 'fleet': the fleet socket has nothing
 *  to say about accounts, sessions or settings. The accounts are shared with
 *  the persons page, which lists and deletes them too. */
export const adminKeys = {
  accounts: qk.accounts,
  sessions: ['admin', 'sessions'] as const,
  ntfy: ['admin', 'ntfy'] as const,
};

/** Same floor as the server (MIN_PASSWORD_LEN in backend/app/accounts.py). */
export const MIN_PASSWORD = 8;

/** Least to most rights: the order of the role pills. */
export const ROLES: Role[] = ['viewer', 'techniker', 'admin'];

/** What a role may do, in one sentence, next to where it is chosen. */
export const ROLE_HINT: Record<Role, string> = {
  viewer: 'Sieht nur die Geräte der verknüpften Person und ändert nichts.',
  techniker: 'Betreut Geräte: Aufträge, Skripte und Updates — keine Konten und Einstellungen.',
  admin: 'Darf alles, auch Konten, Einstellungen und das Audit-Log.',
};

/** The server refuses these for the signed-in admin's own account
 *  (accounts_admin.py); the page says so before anyone tries. */
export const SELF_LOCK =
  'Das eigene Konto lässt sich hier nicht herabstufen, deaktivieren oder löschen — so sperrt sich niemand versehentlich aus. Das kann nur ein anderes Admin-Konto.';

export const isForbidden = (e: unknown): boolean => e instanceof ApiError && e.status === 403;

/** What a 403 means here. The server's own text is English and terse. */
export const FORBIDDEN_TEXT =
  'Dafür braucht es ein Admin-Konto. Wurde deine Rolle gerade geändert, bitte neu anmelden.';

/** An error as it should reach the screen: a 403 explained, everything
 *  else unchanged (the server's German detail is already the best text). */
export const explain = (e: unknown): unknown => (isForbidden(e) ? new Error(FORBIDDEN_TEXT) : e);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The panel's one-line reading: how many, and what needs a look. */
export function accountSummary(list: Account[]): string {
  const parts = [plural(list.length, 'Konto', 'Konten')];
  const off = list.filter((a) => a.disabled).length;
  // A disabled account cannot sign in, so its missing second factor is no risk.
  const open = list.filter((a) => !a.disabled && !a.totp_enabled).length;
  if (off > 0) parts.push(`${off} deaktiviert`);
  if (open > 0) parts.push(`${open} ohne Zwei-Faktor`);
  return parts.join(' · ');
}

// ---- Sorting ----------------------------------------------------------------

export type SortKey = 'name' | 'role' | 'mail' | 'totp' | 'login';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: Sort = { key: 'name', dir: 'asc' };
const SORT_KEYS: SortKey[] = ['name', 'role', 'mail', 'totp', 'login'];
/** Where a first click on a column starts: the latest login on top. */
const FIRST_DIR: Record<SortKey, SortDir> = { name: 'asc', role: 'asc', mail: 'asc', totp: 'asc', login: 'desc' };

/** `?sort=login-desc` → a sort; anything unknown is the default. */
export function parseSort(raw: string | null): Sort {
  const [key, dir] = (raw ?? '').split('-');
  if (!SORT_KEYS.includes(key as SortKey)) return DEFAULT_SORT;
  return { key: key as SortKey, dir: dir === 'desc' ? 'desc' : 'asc' };
}

/** The URL value of a sort; null for the default, which keeps the URL clean. */
export function formatSort(s: Sort): string | null {
  return s.key === DEFAULT_SORT.key && s.dir === DEFAULT_SORT.dir ? null : `${s.key}-${s.dir}`;
}

export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: FIRST_DIR[key] };
}

const ROLE_RANK: Record<Role, number> = { admin: 0, techniker: 1, viewer: 2 };
const byName = (a: Account, b: Account) => a.username.localeCompare(b.username, 'de', { sensitivity: 'base' });

/**
 * Accounts in the requested order. Missing values ("nie" angemeldet, no
 * e-mail) stay at the bottom in both directions — they are never the answer
 * to "who logged in last". Ties fall back to the name.
 */
export function sortAccounts(list: Account[], sort: Sort): Account[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (a: Account): string | number | null => {
    switch (sort.key) {
      case 'name':
        return null;
      case 'role':
        return ROLE_RANK[a.role] ?? 9;
      case 'mail':
        return a.email ? a.email.toLowerCase() : null;
      case 'totp':
        return a.totp_enabled ? 1 : 0;
      case 'login':
        return a.last_login_at;
    }
  };
  return [...list].sort((a, b) => {
    if (sort.key === 'name') return sign * byName(a, b);
    const va = value(a);
    const vb = value(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'de') : Number(va) - Number(vb);
      return sign * cmp;
    }
    return byName(a, b);
  });
}

// ---- Forms --------------------------------------------------------------------

export interface AccountDraft {
  username: string;
  password: string;
  role: Role;
  email: string;
}

export const EMPTY_DRAFT: AccountDraft = { username: '', password: '', role: 'viewer', email: '' };

/** The server compares names without case (COLLATE NOCASE). */
export function nameTaken(name: string, accounts: Account[]): boolean {
  const n = name.trim().toLowerCase();
  return n !== '' && accounts.some((a) => a.username.toLowerCase() === n);
}

/** How many characters a password still lacks; 0 once it is long enough. */
export const passwordShortfall = (pw: string): number => Math.max(0, MIN_PASSWORD - pw.length);

/** The password hint, counting down while someone types. */
export function passwordHint(pw: string): string {
  const missing = passwordShortfall(pw);
  return pw && missing > 0 ? `Mindestens ${MIN_PASSWORD} Zeichen — noch ${missing}.` : `Mindestens ${MIN_PASSWORD} Zeichen.`;
}

export function draftReady(d: AccountDraft, accounts: Account[]): boolean {
  return d.username.trim() !== '' && !nameTaken(d.username, accounts) && passwordShortfall(d.password) === 0;
}

/** An authenticator code: six digits, whatever else was pasted with it. */
export const totpCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

/** Disabling takes a current code or a backup code ("1a2b-3c4d"). */
export const disableCode = (raw: string): string => raw.trim().slice(0, 12);

/** A TOTP secret in blocks of four, so it can be typed off the screen
 *  without losing the place. Authenticator apps ignore the spaces. */
export const groupSecret = (secret: string): string => secret.match(/.{1,4}/g)?.join(' ') ?? '';

// ---- Dates and files -----------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

/** TT.MM.JJJJ */
export function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** The backup codes as a file worth keeping: whose they are and how they work. */
export function backupCodesText(username: string, codes: string[], issuedAt: number): string {
  return [
    `Vulpexa — Backup-Codes für ${username}`,
    `Ausgestellt am ${formatDate(issuedAt)}. Jeder Code gilt genau einmal anstelle des Codes aus der App.`,
    '',
    ...codes,
    '',
  ].join('\n');
}

/** The clipboard is missing outside a secure context and may be refused;
 *  either way this rejects, so the caller can say so. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('Zwischenablage nicht verfügbar');
  await navigator.clipboard.writeText(text);
}

/** A file name that survives every file system, whatever the user is called. */
export function backupCodesFile(username: string): string {
  const safe = username.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'konto';
  return `vulpexa-backup-codes-${safe}.txt`;
}

export function downloadText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next task: some browsers start the download only after
  // the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
