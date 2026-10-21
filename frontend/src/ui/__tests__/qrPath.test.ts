import { describe, expect, it } from 'vitest';
import { qrPath } from '../qrPath';

describe('qrPath', () => {
  it('draws a symbol with quiet zone and finder pattern', () => {
    const { size, d } = qrPath('https://rmm.example.org/api/mdm/enroll/mde_abcdefghijklmnopqrstuvwxyz012345');
    // Symbol sizes are 21 + 4k modules; plus 4 modules of quiet zone per side.
    expect((size - 8 - 21) % 4).toBe(0);
    // The top-left finder pattern starts right after the quiet zone.
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
    // Nothing is drawn inside the quiet zone.
    expect(d).not.toMatch(/M[0-3] /);
  });

  it('is deterministic for the same text', () => {
    expect(qrPath('x').d).toBe(qrPath('x').d);
    expect(qrPath('x').d).not.toBe(qrPath('y').d);
  });
});
