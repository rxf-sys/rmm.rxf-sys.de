/**
 * Apple MDM: which devices can be enrolled, and how a state reads.
 *
 * The server decides all of it again (backend/app/routers/mdm.py) — this
 * only keeps the dashboard from offering what would be refused.
 */

import { deviceClass } from './deviceClass';
import type { Device, DeviceMdm, MdmEnrollmentState } from './types';
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
  ['IsSupervised', 'Betreut (Supervised)'],
  ['IsActivationLockEnabled', 'Aktivierungssperre'],
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
    return String(value);
  }
  return value;
}
