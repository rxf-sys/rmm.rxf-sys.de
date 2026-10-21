import { describe, expect, it } from 'vitest';
import { PACKAGE_ID, SOFTWARE, availableOn, installCommand } from '../softwareCatalog';

describe('software catalog', () => {
  it('only holds package ids that cannot break out of a quoted shell word', () => {
    for (const p of SOFTWARE) {
      for (const id of [p.winget, p.apt, p.dnf, p.brew].filter(Boolean)) {
        expect(id, `${p.name}: ${id}`).toMatch(PACKAGE_ID);
      }
    }
  });

  it('has unique ids and offers every entry somewhere', () => {
    expect(new Set(SOFTWARE.map((p) => p.id)).size).toBe(SOFTWARE.length);
    for (const p of SOFTWARE) {
      expect(['windows', 'linux', 'darwin'].some((os) => availableOn(p, os)), p.name).toBe(true);
    }
  });

  it('resolves winget for the SYSTEM account and installs machine-wide', () => {
    const cmd = installCommand(SOFTWARE.find((p) => p.id === '7zip')!, 'windows')!;
    expect(cmd.shell).toBe('powershell');
    expect(cmd.command).toContain('DesktopAppInstaller_');
    expect(cmd.command).toContain("--id '7zip.7zip' --exact");
    expect(cmd.command).toContain('--scope machine');
  });

  it('picks apt or dnf on Linux and fails clearly without either', () => {
    const cmd = installCommand(SOFTWARE.find((p) => p.id === 'git')!, 'linux')!;
    expect(cmd.shell).toBe('bash');
    expect(cmd.command).toContain("apt-get install -y -q 'git'");
    expect(cmd.command).toContain("dnf install -y -q 'git'");
    expect(cmd.command).toContain('exit 1');
  });

  it('runs Homebrew as the console user, with --cask for apps', () => {
    const cmd = installCommand(SOFTWARE.find((p) => p.id === 'firefox')!, 'darwin')!;
    expect(cmd.shell).toBe('zsh');
    expect(cmd.command).toContain('sudo -u "$user" -H "$brew" install --cask \'firefox\'');
    expect(installCommand(SOFTWARE.find((p) => p.id === 'git')!, 'darwin')!.command).not.toContain('--cask');
  });

  it('offers nothing where the system has no package for it', () => {
    expect(installCommand(SOFTWARE.find((p) => p.id === 'notepadpp')!, 'linux')).toBeNull();
    expect(installCommand(SOFTWARE.find((p) => p.id === 'git')!, 'ios')).toBeNull();
  });
});
