import { describe, expect, it } from 'vitest';
import { osMatchesDevice, shellsFor } from '../scriptOs';

describe('osMatchesDevice', () => {
  it('lets a cross-platform script run anywhere', () => {
    expect(osMatchesDevice('any', 'windows')).toBe(true);
    expect(osMatchesDevice('any', 'linux')).toBe(true);
  });

  it('keeps a PowerShell script off a Linux box', () => {
    // Genau das bot der Remote-Reiter vorher an — der Job wäre erst auf dem
    // Gerät gescheitert.
    expect(osMatchesDevice('windows', 'linux')).toBe(false);
    expect(osMatchesDevice('windows', 'windows')).toBe(true);
  });
});

describe('shellsFor', () => {
  it('offers only what the system has', () => {
    expect(shellsFor('windows')).toEqual(['powershell']);
    expect(shellsFor('darwin')[0]).toBe('zsh');
    expect(shellsFor('linux')).toContain('bash');
    expect(shellsFor('linux')).not.toContain('powershell');
  });

  it('falls back to the Unix shells for an unknown system', () => {
    expect(shellsFor('freebsd')).toEqual(['bash', 'zsh']);
  });
});
