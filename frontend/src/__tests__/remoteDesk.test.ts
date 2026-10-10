import { describe, expect, it } from 'vitest';
import { cleanRustdeskId, isRustdeskId, safeDeepLink } from '../remoteDesk';

describe('RustDesk IDs', () => {
  it('accepts generated and custom IDs', () => {
    expect(isRustdeskId('123456789')).toBe(true);
    expect(isRustdeskId('office-pc_01')).toBe(true);
    expect(cleanRustdeskId(' 123 456 789 ')).toBe('123456789');
  });

  it('refuses anything that could steer the client elsewhere', () => {
    expect(isRustdeskId('123456789@relay.evil.example')).toBe(false);
    expect(isRustdeskId('123/../x')).toBe(false);
    expect(isRustdeskId('12345')).toBe(false);
    expect(safeDeepLink('rustdesk://123456789')).toBe('rustdesk://123456789');
    expect(safeDeepLink('rustdesk://123?password=x')).toBeNull();
    expect(safeDeepLink('javascript:alert(1)')).toBeNull();
  });
});
