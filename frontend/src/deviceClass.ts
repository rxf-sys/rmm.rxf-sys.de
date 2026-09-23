/**
 * Geräte mit Agent und Geräte ohne.
 *
 * Ein Telefon steht in derselben Liste wie ein Rechner, kann aber nichts von
 * dem, was den Rechner ausmacht: keine Shell, keine Auslastung, kein
 * Update-Scan. Damit die Oberfläche das nicht an zwölf Stellen einzeln
 * entscheidet, steht die Unterscheidung hier — der Server lehnt dieselben
 * Aufrufe unabhängig davon ab (backend/app/device_policy.py).
 */

import type { Device, DeviceClass } from './types';

export const OWNERSHIP_LABEL: Record<'private' | 'company', string> = {
  private: 'Privatgerät',
  company: 'Firmengerät',
};

/** Klasse eines Geräts; alles Unbekannte gilt als Gerät mit Agent. */
export function deviceClass(d: Pick<Device, 'device_class'>): DeviceClass {
  return d.device_class === 'mobile' ? 'mobile' : 'agent';
}

export function isAgent(d: Pick<Device, 'device_class'>): boolean {
  return deviceClass(d) === 'agent';
}

/** Kurzform fürs Besitzverhältnis, leer wenn nichts hinterlegt ist. */
export function ownershipLabel(d: Pick<Device, 'ownership'>): string {
  return d.ownership === 'private' || d.ownership === 'company'
    ? OWNERSHIP_LABEL[d.ownership]
    : '';
}
