import { roleLabel } from '../../format';
import type { Account, Role } from '../../types';
import { ROLE_HINT, seesNothing } from './accounts';

/** What `useConfirm().ask` takes; every text names the account concerned. */
export interface AskText {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
}

const q = (name: string) => `„${name}“`;

/**
 * A role change that grants or takes away admin rights asks first: it decides
 * who may manage accounts, settings and the audit log. So does making a
 * viewer of an account without a person — it would see no device at all. A
 * move between viewer and technician applies at once otherwise. Null means
 * "no question".
 */
export function roleChangeText(a: Account, role: Role): AskText | null {
  if (role === a.role) return null;
  if (role === 'admin')
    return {
      title: `${q(a.username)} zum Administrator machen?`,
      body: `${q(a.username)} darf danach alles — auch Konten anlegen und löschen, Einstellungen ändern und das Audit-Log lesen.`,
      confirmLabel: 'Zum Administrator machen',
    };
  // Judged with the new role: would the account see nothing afterwards?
  const blind = seesNothing({ ...a, role })
    ? `${q(a.username)} ist mit keiner Person verknüpft und sieht danach keine Geräte, bis über „Person zuordnen …“ im Menü der Zeile eine gewählt ist.`
    : '';
  if (a.role === 'admin')
    return {
      title: `${q(a.username)} herabstufen?`,
      body: `${q(a.username)} wird ${roleLabel(role)} und verliert den Zugriff auf Konten, Einstellungen und das Audit-Log. ${ROLE_HINT[role]}${blind && ` ${blind}`}`,
      confirmLabel: `Zum ${roleLabel(role)} machen`,
      danger: true,
    };
  if (blind)
    return {
      title: `${q(a.username)} zum ${roleLabel(role)} machen?`,
      body: `Ein ${roleLabel(role)} sieht nur die Geräte seiner Person. ${blind}`,
      confirmLabel: `Zum ${roleLabel(role)} machen`,
    };
  return null;
}

export function resetTotpText(a: Account, self: boolean): AskText {
  return {
    title: `Zwei-Faktor von ${q(a.username)} zurücksetzen?`,
    body: self
      ? 'Schlüssel und Backup-Codes deines eigenen Kontos werden entfernt, ohne dass ein Code nötig ist. Bis zur neuen Einrichtung genügt für dich das Passwort.'
      : `Schlüssel und Backup-Codes von ${q(a.username)} werden entfernt. Bis zur neuen Einrichtung genügt für dieses Konto das Passwort — gedacht für ein verlorenes Telefon.`,
    confirmLabel: 'Zwei-Faktor zurücksetzen',
    danger: true,
  };
}

export function disableText(a: Account): AskText {
  return {
    title: `${q(a.username)} deaktivieren?`,
    body: `${q(a.username)} kann sich danach nicht mehr anmelden, offene Sitzungen enden sofort. Das Konto bleibt mit Rolle und Verknüpfungen erhalten und lässt sich jederzeit wieder aktivieren.`,
    confirmLabel: 'Deaktivieren',
    danger: true,
  };
}

/** Deleting cannot be taken back, so the name has to be typed. */
export function deleteText(a: Account): AskText {
  return {
    title: `${q(a.username)} löschen?`,
    body: `Das Konto ${q(a.username)} wird gelöscht, alle seine Sitzungen enden. Geräte, Personen und Audit-Einträge bleiben erhalten. Wer das Konto nur sperren will, deaktiviert es besser.`,
    confirmLabel: 'Konto löschen',
    danger: true,
    requireText: a.username,
  };
}
