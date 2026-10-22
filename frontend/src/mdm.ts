/**
 * Apple MDM: which devices can be enrolled, and how a state reads.
 *
 * The server decides all of it again (backend/app/routers/mdm.py) — this
 * only keeps the dashboard from offering what would be refused.
 */

import { deviceClass } from './deviceClass';
import type {
  Device,
  DeviceMdm,
  IosStatus,
  MdmAssignmentState,
  MdmCommandStatus,
  MdmConfigKind,
  MdmEnrollmentState,
  MdmPermission,
} from './types';
import type { StatusKind } from './ui';

/** AccessRights bit "Device erase" (Apple MDM payload reference). */
export const ACCESS_ERASE = 8;

export function isAppleMobile(d: Pick<Device, 'device_class' | 'os'>): boolean {
  return deviceClass(d) === 'mobile' && (d.os === 'ios' || d.os === 'ipados');
}

export function hasEraseRight(accessRights: number): boolean {
  return (accessRights & ACCESS_ERASE) !== 0;
}

/** One status for the device, from enrollment and binding together. */
export type MdmStatus = 'none' | MdmEnrollmentState | 'removed';

export function mdmStatus(m: Pick<DeviceMdm, 'enrollment' | 'binding'>): MdmStatus {
  if (m.binding) return m.binding.checked_out_at ? 'removed' : 'enrolled';
  return m.enrollment?.state ?? 'none';
}

export const MDM_STATUS: Record<MdmStatus, { label: string; kind: StatusKind; text: string }> = {
  none: { label: 'Nicht registriert', kind: 'neutral', text: 'Noch kein Registrierungslink erzeugt.' },
  waiting: { label: 'Wartet auf das Gerät', kind: 'info', text: 'Der Link ist aktiv, das Profil wurde noch nicht geladen.' },
  downloaded: {
    label: 'Profil geladen',
    kind: 'info',
    text: 'Jetzt am Gerät in den Einstellungen unter „Profil geladen“ installieren.',
  },
  certificate: {
    label: 'Zertifikat ausgestellt',
    kind: 'info',
    text: 'Das Gerät hat seine Identität erhalten; die Anmeldung beim MDM folgt.',
  },
  enrolled: { label: 'Registriert', kind: 'ok', text: 'Das Gerät ist verwaltet und per Push erreichbar.' },
  expired: { label: 'Link abgelaufen', kind: 'warn', text: 'Für eine Registrierung einen neuen Link erzeugen.' },
  revoked: { label: 'Link widerrufen', kind: 'off', text: 'Für eine Registrierung einen neuen Link erzeugen.' },
  removed: {
    label: 'Profil entfernt',
    kind: 'warn',
    text: 'Das MDM-Profil wurde am Gerät gelöscht. Eine erneute Registrierung braucht einen neuen Link.',
  },
};

/** Fields of the DeviceInformation answer worth a row, in this order. */
export const MDM_INFO_LABELS: [key: string, label: string][] = [
  ['DeviceName', 'Gerätename'],
  ['ModelName', 'Modell'],
  ['ProductName', 'Produkt-ID'],
  ['OSVersion', 'Systemversion'],
  ['BuildVersion', 'Build'],
  ['SerialNumber', 'Seriennummer'],
  ['IMEI', 'IMEI'],
  ['DeviceCapacity', 'Speicher'],
  ['AvailableDeviceCapacity', 'Davon frei'],
  ['BatteryLevel', 'Akku'],
  ['WiFiMAC', 'WLAN-MAC'],
  ['PhoneNumber', 'Rufnummer'],
  ['CurrentCarrierNetwork', 'Mobilfunknetz'],
  ['ICCID', 'ICCID (SIM)'],
  ['IsRoaming', 'Roaming'],
  ['DataRoamingEnabled', 'Daten-Roaming erlaubt'],
  ['PersonalHotspotEnabled', 'Persönlicher Hotspot'],
  ['IsSupervised', 'Betreut (Supervised)'],
];

/** DeviceInformation fields the server copies into the device's own
 *  columns (version, model, serial, IMEI): the overview shows them once,
 *  under Stammdaten, not a second time among the reported facts — as long
 *  as the column holds a value. */
export const MDM_SYNCED_INFO: Record<string, 'os_version' | 'model' | 'serial' | 'imei'> = {
  OSVersion: 'os_version',
  ModelName: 'model',
  ProductName: 'model',
  SerialNumber: 'serial',
  IMEI: 'imei',
};

/** Security facts from DeviceInformation that belong next to SecurityInfo. */
export const MDM_SECURITY_INFO_LABELS: [key: string, label: string][] = [
  ['IsActivationLockEnabled', 'Aktivierungssperre'],
  ['IsDeviceLocatorServiceEnabled', '„Wo ist?“'],
  ['IsCloudBackupEnabled', 'iCloud-Backup'],
  ['LastCloudBackupDate', 'Letztes iCloud-Backup'],
  ['IsMDMLostModeEnabled', 'Verloren-Modus'],
];

const GB = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const PCT = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 });

/** A DeviceInformation value as text. Capacities arrive in GB, the battery
 *  as a fraction between 0 and 1. */
export function formatMdmInfo(key: string, value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'number') {
    if (key === 'BatteryLevel') return value < 0 ? 'unbekannt' : PCT.format(value);
    if (key === 'DeviceCapacity' || key === 'AvailableDeviceCapacity') return `${GB.format(value)} GB`;
    if (key === 'LastCloudBackupDate') return new Date(value * 1000).toLocaleString('de-DE');
    return String(value);
  }
  return value;
}

/** Passcode and data protection, from the SecurityInfo answer. Each row says
 *  whether the value is the good one, so the panel can mark it. */
export function securityRows(
  security: Record<string, string | number | boolean>,
): { label: string; text: string; ok: boolean | null }[] {
  const rows: { label: string; text: string; ok: boolean | null }[] = [];
  const yesNo = (v: unknown) => (v === true ? 'ja' : v === false ? 'nein' : 'unbekannt');
  if ('PasscodePresent' in security)
    rows.push({ label: 'Gerätecode gesetzt', text: yesNo(security.PasscodePresent), ok: security.PasscodePresent === true });
  if ('PasscodeCompliant' in security)
    rows.push({
      label: 'Code erfüllt die Regeln',
      text: yesNo(security.PasscodeCompliant),
      ok: security.PasscodeCompliant === true,
    });
  const caps = security.HardwareEncryptionCaps;
  if (typeof caps === 'number') {
    // Bit 2: file-level Data Protection — on iOS on as soon as a code is set.
    const fileLevel = (caps & 2) !== 0;
    rows.push({ label: 'Datenschutz (Verschlüsselung)', text: fileLevel ? 'aktiv' : 'nicht aktiv', ok: fileLevel });
  }
  return rows;
}

export const IOS_STATUS: Record<IosStatus, { label: string; kind: StatusKind }> = {
  current: { label: 'aktuell', kind: 'ok' },
  major_behind: { label: 'neue Hauptversion verfügbar', kind: 'info' },
  outdated: { label: 'veraltet', kind: 'warn' },
  unknown: { label: 'unbekannt', kind: 'neutral' },
};

/** Commands as the history lists them. */
export const MDM_COMMAND_LABEL: Record<string, string> = {
  DeviceInformation: 'Geräteinformationen',
  SecurityInfo: 'Sicherheitsstatus',
  ProfileList: 'Profile',
  CertificateList: 'Zertifikate',
  InstalledApplicationList: 'App-Liste',
  DeviceLock: 'Sperren',
  EraseDevice: 'Löschen',
  ClearPasscode: 'Code entfernen',
  InstallProfile: 'Profil installieren',
  RemoveProfile: 'Profil entfernen',
  InstallApplication: 'App installieren',
  ManagedApplicationList: 'Verwaltete Apps',
  DeclarativeManagement: 'Deklarationen abgleichen',
};

export const MDM_COMMAND_STATUS: Record<MdmCommandStatus, { label: string; kind: StatusKind }> = {
  queued: { label: 'Wartet auf das Gerät', kind: 'info' },
  acknowledged: { label: 'Ausgeführt', kind: 'ok' },
  notnow: { label: 'Gerät gesperrt, später', kind: 'info' },
  error: { label: 'Fehler', kind: 'danger' },
  failed: { label: 'Nicht verschickt', kind: 'danger' },
};

export const MDM_PERMISSION: Record<MdmPermission, { label: string; text: string }> = {
  lock: { label: 'Sperren', text: 'Gerät aus der Ferne sperren, mit Nachricht auf dem Sperrbildschirm.' },
  clear_passcode: { label: 'Code entfernen', text: 'Den Gerätecode löschen, wenn er vergessen wurde.' },
  erase: { label: 'Löschen', text: 'Das Gerät auf Werkseinstellungen zurücksetzen. Alle Daten sind danach weg.' },
  apps: { label: 'App-Liste', text: 'Abfragen, welche Apps installiert sind.' },
  profiles: { label: 'Profile', text: 'WLAN, Code-Pflicht, Web-Clips und Konten aufs Gerät bringen.' },
  install_apps: { label: 'Apps installieren', text: 'Apps aus dem App Store anbieten; das Gerät fragt den Nutzer.' },
  os_update: { label: 'iOS-Update', text: 'Ein iOS-Update bis zu einem Termin erzwingen (Test).' },
};

/** States of an app Vulpexa installed (ManagedApplicationList). */
export const MANAGED_APP_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  Managed: { label: 'installiert', kind: 'ok' },
  Prompting: { label: 'wartet auf Zustimmung', kind: 'info' },
  PromptingForLogin: { label: 'wartet auf Apple-ID', kind: 'info' },
  Installing: { label: 'wird installiert', kind: 'info' },
  Queued: { label: 'in der Warteschlange', kind: 'info' },
  NeedsRedemption: { label: 'braucht Einlösung', kind: 'warn' },
  UserRejected: { label: 'abgelehnt', kind: 'warn' },
  UserInstalledApp: { label: 'vom Nutzer installiert', kind: 'neutral' },
  ManagedButUninstalled: { label: 'vom Nutzer gelöscht', kind: 'warn' },
  Failed: { label: 'fehlgeschlagen', kind: 'danger' },
};

/** Profile templates: how each kind is named. */
export const CONFIG_KIND_LABEL: Record<MdmConfigKind, string> = {
  passcode: 'Code-Pflicht',
  wifi: 'WLAN',
  webclip: 'Web-Clip',
  mail: 'Mail-Konto',
  caldav: 'Kalender-Konto',
  carddav: 'Kontakte-Konto',
};

export const ASSIGNMENT_STATE: Record<MdmAssignmentState, { label: string; kind: StatusKind }> = {
  installing: { label: 'wird installiert', kind: 'info' },
  installed: { label: 'installiert', kind: 'ok' },
  removing: { label: 'wird entfernt', kind: 'info' },
  error: { label: 'Fehler', kind: 'danger' },
};
