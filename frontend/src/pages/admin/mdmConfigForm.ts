/**
 * The form for each kind of profile template, as data: which fields, how
 * they read, what they start with. The server validates the same
 * (backend/app/mdm_payloads.py); this only keeps the dialog in one place.
 */
import type { MdmConfig, MdmConfigKind } from '../../types';

export type FieldValue = string | number | boolean | null;

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'bool' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

const DAV = (what: string, port: number): Field[] => [
  { key: 'description', label: 'Bezeichnung', type: 'text', placeholder: `${what} Familie`, required: true },
  { key: 'host', label: 'Server', type: 'text', placeholder: 'cloud.example.org', required: true },
  { key: 'port', label: 'Port', type: 'number', placeholder: String(port) },
  { key: 'username', label: 'Benutzername', type: 'text', required: true },
  { key: 'use_ssl', label: 'Verschlüsselt (SSL/TLS)', type: 'bool' },
  {
    key: 'principal_url',
    label: 'Principal-URL (optional)',
    type: 'text',
    placeholder: 'https://cloud.example.org/remote.php/dav/principals/users/name/',
    hint: 'Nur nötig, wenn der Server sie nicht selbst nennt.',
  },
];

export const CONFIG_FIELDS: Record<MdmConfigKind, Field[]> = {
  passcode: [
    { key: 'min_length', label: 'Mindestlänge', type: 'number', placeholder: '6', hint: '4 bis 16 Zeichen.' },
    { key: 'require_alphanumeric', label: 'Buchstaben und Ziffern verlangen', type: 'bool' },
    { key: 'allow_simple', label: 'Einfache Codes wie 1234 erlauben', type: 'bool' },
    {
      key: 'max_inactivity_minutes',
      label: 'Automatische Sperre',
      type: 'select',
      options: [
        { value: '', label: 'Nutzer entscheidet' },
        ...[1, 2, 3, 4, 5].map((m) => ({ value: String(m), label: `nach ${m} Minute${m === 1 ? '' : 'n'}` })),
      ],
    },
  ],
  wifi: [
    { key: 'ssid', label: 'Netzwerkname (SSID)', type: 'text', required: true },
    {
      key: 'security',
      label: 'Sicherheit',
      type: 'select',
      options: [
        { value: 'WPA2', label: 'WPA2' },
        { value: 'WPA3', label: 'WPA3' },
        { value: 'None', label: 'Offen (kein Passwort)' },
      ],
    },
    { key: 'hidden', label: 'Verstecktes Netzwerk', type: 'bool' },
    { key: 'auto_join', label: 'Automatisch verbinden', type: 'bool' },
  ],
  webclip: [
    { key: 'label', label: 'Name auf dem Home-Bildschirm', type: 'text', required: true },
    { key: 'url', label: 'Adresse', type: 'text', placeholder: 'https://', required: true },
    { key: 'full_screen', label: 'Als Vollbild-App öffnen', type: 'bool' },
    { key: 'removable', label: 'Nutzer darf es entfernen', type: 'bool' },
  ],
  mail: [
    { key: 'description', label: 'Bezeichnung', type: 'text', placeholder: 'Mail Büro', required: true },
    { key: 'address', label: 'E-Mail-Adresse', type: 'text', required: true },
    { key: 'username', label: 'Benutzername', type: 'text', required: true },
    { key: 'imap_host', label: 'IMAP-Server', type: 'text', required: true },
    { key: 'imap_port', label: 'IMAP-Port', type: 'number', placeholder: '993' },
    { key: 'smtp_host', label: 'SMTP-Server', type: 'text', required: true },
    { key: 'smtp_port', label: 'SMTP-Port', type: 'number', placeholder: '587' },
    { key: 'use_ssl', label: 'Verschlüsselt (SSL/TLS)', type: 'bool' },
  ],
  caldav: DAV('Kalender', 443),
  carddav: DAV('Kontakte', 443),
};

const DEFAULTS: Record<MdmConfigKind, Record<string, FieldValue>> = {
  passcode: { min_length: 6, require_alphanumeric: false, allow_simple: false, max_inactivity_minutes: null },
  wifi: { ssid: '', security: 'WPA2', hidden: false, auto_join: true },
  webclip: { label: '', url: 'https://', full_screen: false, removable: true },
  mail: {
    description: '',
    address: '',
    username: '',
    imap_host: '',
    imap_port: 993,
    smtp_host: '',
    smtp_port: 587,
    use_ssl: true,
  },
  caldav: { description: '', host: '', port: 443, username: '', use_ssl: true, principal_url: '' },
  carddav: { description: '', host: '', port: 443, username: '', use_ssl: true, principal_url: '' },
};

export function defaultsFor(kind: MdmConfigKind): Record<string, FieldValue> {
  return { ...DEFAULTS[kind] };
}

/** Does this template need a password? Wi-Fi only when it is not open. */
export function needsPassword(kind: MdmConfigKind, settings: Record<string, FieldValue>): boolean {
  if (kind === 'wifi') return settings.security !== 'None';
  return kind === 'mail' || kind === 'caldav' || kind === 'carddav';
}

/** One line under the template's name in the list. */
export function configSummary(c: Pick<MdmConfig, 'kind' | 'settings'>): string {
  const s = c.settings;
  switch (c.kind) {
    case 'passcode':
      return `mind. ${s.min_length ?? 6} Zeichen${s.require_alphanumeric ? ', Buchstaben und Ziffern' : ''}`;
    case 'wifi':
      return `${s.ssid ?? ''} · ${s.security === 'None' ? 'offen' : String(s.security ?? 'WPA2')}`;
    case 'webclip':
      return String(s.url ?? '');
    case 'mail':
      return String(s.address ?? '');
    default:
      return `${String(s.username ?? '')}@${String(s.host ?? '')}`;
  }
}
