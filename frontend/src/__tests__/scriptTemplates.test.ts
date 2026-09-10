import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../scriptTemplates';

describe('script templates', () => {
  it('all carry a name, a one-line summary and a body', () => {
    for (const t of TEMPLATES) {
      expect(t.name.trim()).not.toBe('');
      expect(t.summary.trim()).not.toBe('');
      expect(t.content.trim()).not.toBe('');
    }
  });

  it('have unique name/os pairs', () => {
    // Two "Netzwerk-Diagnose" entries exist on purpose — one per OS.
    const keys = TEMPLATES.map((t) => `${t.name}|${t.os}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pair the shell with the OS', () => {
    for (const t of TEMPLATES) {
      if (t.shell === 'powershell') expect(t.os).toBe('windows');
      if (t.os === 'linux') expect(t.shell).not.toBe('powershell');
    }
  });

  it('keeps the destructive flag on the entries that earn it', () => {
    // Named explicitly rather than guessed from the title: "Drucker-Spooler
    // zurücksetzen" also reads destructive and is routine maintenance. The
    // point of the list is that nobody can quietly un-flag these three.
    const mustBeDangerous = [
      'Gerät sofort neu starten',
      'Windows-Update-Komponenten zurücksetzen',
      'Proxmox: alle LXC-Container aktualisieren',
    ];
    for (const name of mustBeDangerous) {
      const t = TEMPLATES.find((x) => x.name === name);
      expect(t, `Vorlage "${name}" fehlt`).toBeDefined();
      expect(t!.danger, `"${name}" muss als destruktiv markiert sein`).toBe(true);
    }
  });
});

describe('proxmox-lxc-update.sh', () => {
  const t = TEMPLATES.find((x) => x.name.startsWith('Proxmox:'));

  it('is loaded from the file, not truncated to an empty string', () => {
    // The ?raw import is the failure mode worth guarding: a wrong path or a
    // build change would hand the library an empty script that looks fine in
    // the gallery and does nothing when run.
    expect(t).toBeDefined();
    expect(t!.content.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(t!.content.length).toBeGreaterThan(2000);
  });

  it('keeps the guards that make it safe to run unattended', () => {
    const c = t!.content;
    // The host loop runs without `set -e` on purpose: one broken container
    // must not abort the rest. (The guest script inside the heredoc does use
    // `set -e` — there, stopping at the first error is right.)
    const firstSet = c.split('\n').find((l) => l.startsWith('set '));
    expect(firstSet).toBe('set -uo pipefail');
    // Runs on the host via pct, per container.
    expect(c).toContain('pct exec');
    // Stops between containers before the agent's job timeout can kill dpkg.
    expect(c).toContain('TOTAL_BUDGET');
    expect(c).toContain('PER_CT_TIMEOUT');
    // Leaves the RMM's own path alone by default.
    expect(c).toContain('EXCLUDE="104 111"');
    // Reports a needed reboot instead of performing one.
    expect(c).toContain('RMM-REBOOT-REQUIRED');
    expect(c).not.toContain('pct reboot');
  });
});
