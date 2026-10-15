import { describe, expect, it } from 'vitest';
import { PLATFORMS, TTL_OPTIONS, downloadCommand, installCommand, setupUrl, tokenRequest } from '../enrollCommands';

const origin = 'https://rmm.example.org';

describe('installCommand', () => {
  it('carries the token in a header, never in the URL', () => {
    for (const p of PLATFORMS) {
      const cmd = installCommand(p.id, { origin, token: 'tok-123', label: '' });
      expect(cmd).toContain('tok-123');
      expect(cmd).not.toMatch(/[?&]token=/);
      expect(cmd).toContain(`${origin}/api/agent/setup/${p.id}`);
    }
  });

  it('speaks PowerShell on Windows and bash with sudo elsewhere', () => {
    expect(installCommand('windows', { origin, token: 't' })).toBe(
      `irm -Headers @{'X-Enroll-Token'='t'} '${origin}/api/agent/setup/windows' | iex`,
    );
    expect(installCommand('linux', { origin, token: 't' })).toBe(
      `curl -fsSL -H 'X-Enroll-Token: t' '${origin}/api/agent/setup/linux' | sudo bash`,
    );
    expect(installCommand('darwin', { origin, token: 't' })).toMatch(/setup\/darwin' \| sudo bash$/);
  });

  it('passes the label along, escaped so a quote cannot end the shell string', () => {
    expect(setupUrl('linux', { origin, label: "Lisa's Laptop" })).toBe(`${origin}/api/agent/setup/linux?label=Lisa%27s%20Laptop`);
    expect(installCommand('windows', { origin, token: 't', label: "Lisa's Laptop" })).not.toContain("Lisa's");
  });
});

describe('downloadCommand', () => {
  it('fetches only the Windows binary, token in the header', () => {
    expect(downloadCommand({ origin, token: 't' })).toBe(
      `irm -Headers @{'X-Enroll-Token'='t'} '${origin}/api/agent/setup/download/windows-amd64' -OutFile $env:TEMP\\rmm-agent.exe`,
    );
  });
});

describe('tokenRequest', () => {
  it('leaves the validity to the server unless one was chosen', () => {
    expect(tokenRequest('  Laptop  ', null)).toEqual({ label: 'Laptop' });
    expect(tokenRequest('', 8)).toEqual({ label: '', ttl_hours: 8 });
  });

  it('offers only validities the server accepts (1 h to 14 days)', () => {
    for (const o of TTL_OPTIONS) {
      if (o.hours === null) continue;
      expect(o.hours).toBeGreaterThanOrEqual(1);
      expect(o.hours).toBeLessThanOrEqual(24 * 14);
    }
    expect(TTL_OPTIONS[0]?.hours).toBeNull();
  });
});
