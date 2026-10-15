/**
 * How a device is named where someone picks or confirms a target.
 *
 * The hostname is whatever the agent reports, so a compromised or misnamed
 * device can carry the same name as a real server. Wherever a name occurs
 * more than once in the fleet, the id goes next to it — otherwise "nas" and
 * "nas" look like one choice in a list and in a confirmation.
 */
import type { Device } from './types';

export function duplicateHostnames(devices: readonly Pick<Device, 'hostname'>[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const d of devices) {
    const k = d.hostname.toLowerCase();
    if (seen.has(k)) dups.add(k);
    seen.add(k);
  }
  return dups;
}

export function deviceLabel(d: Pick<Device, 'id' | 'hostname'>, dups: Set<string>): string {
  return dups.has(d.hostname.toLowerCase()) ? `${d.hostname} (#${d.id})` : d.hostname;
}
