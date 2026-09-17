import { describe, expect, it } from 'vitest';
import { deviceClass, isAgent, ownershipLabel } from '../deviceClass';
import type { Device } from '../types';

describe('deviceClass', () => {
  it('behandelt Unbekanntes als Gerät mit Agent', () => {
    // Zeilen aus einer Datenbank vor der Migration tragen kein Feld — und
    // stammen sämtlich aus einem Enrollment.
    expect(deviceClass({ device_class: undefined as unknown as Device['device_class'] })).toBe('agent');
    expect(isAgent({ device_class: 'agent' })).toBe(true);
    expect(isAgent({ device_class: 'mobile' })).toBe(false);
  });

  it('benennt das Besitzverhältnis nur, wenn eines gesetzt ist', () => {
    expect(ownershipLabel({ ownership: 'private' })).toBe('Privatgerät');
    expect(ownershipLabel({ ownership: 'company' })).toBe('Firmengerät');
    expect(ownershipLabel({ ownership: '' })).toBe('');
  });
});
