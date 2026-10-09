import { describe, expect, it } from 'vitest';
import type { Device } from '../../../types';
import { restartCommand } from '../../../deviceCommands';
import { partition, runBulk, skippedText } from '../bulk';

describe('runBulk', () => {
  it('keeps going past failures and reports them', async () => {
    const res = await runBulk([1, 2, 3, 4], async (n) => {
      if (n % 2 === 0) throw new Error(`nope ${n}`);
    });
    expect(res.ok.sort()).toEqual([1, 3]);
    expect(res.failed.map((f) => f.item).sort()).toEqual([2, 4]);
  });

  it('never runs more than the given number at once', async () => {
    let running = 0;
    let peak = 0;
    await runBulk(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
      },
      3,
    );
    expect(peak).toBe(3);
  });

  it('handles an empty selection', async () => {
    expect(await runBulk([], async () => {})).toEqual({ ok: [], failed: [] });
  });
});

describe('restartCommand', () => {
  it('warns signed-in users on every system and uses that system’s shell', () => {
    expect(restartCommand('windows')).toEqual({ command: expect.stringContaining('/t 60'), shell: 'powershell' });
    expect(restartCommand('linux')).toEqual({ command: expect.stringContaining('+1'), shell: 'bash' });
    expect(restartCommand('darwin')?.shell).toBe('zsh');
    expect(restartCommand('ios')).toBeNull();
  });

  it('keeps the message ASCII for the Windows console', () => {
    for (const os of ['windows', 'linux', 'darwin']) {
      expect(/^[\x20-\x7e]*$/.test(restartCommand(os)!.command)).toBe(true);
    }
  });
});

describe('partition', () => {
  it('counts each skipped device under the first rule it fails', () => {
    const d = (over: Partial<Device>) => ({ id: 1, connected: true, os: 'linux', ...over }) as Device;
    const { targets, skipped } = partition(
      [d({ id: 1 }), d({ id: 2, connected: false }), d({ id: 3, os: 'ios', connected: false })],
      [
        { test: (x) => x.os !== 'ios', reason: 'ohne Agent' },
        { test: (x) => x.connected, reason: 'ohne Verbindung' },
      ],
    );
    expect(targets.map((x) => x.id)).toEqual([1]);
    expect(skippedText(skipped)).toBe('1 ohne Verbindung, 1 ohne Agent');
  });
});
