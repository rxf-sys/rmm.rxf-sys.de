/** Shell commands the UI issues on its own, per operating system. */
import type { Shell } from './types';

/**
 * The restart command per operating system. Every variant waits a minute and
 * tells whoever is signed in, so nobody loses their work to a reboot that
 * came out of nowhere. ASCII only: the message travels through PowerShell
 * and a console code page that may not be UTF-8.
 */
export function restartCommand(os: string): { command: string; shell: Shell } | null {
  switch (os) {
    case 'windows':
      return { command: 'shutdown.exe /r /t 60 /c "Neustart durch Vulpexa in 60 Sekunden"', shell: 'powershell' };
    case 'linux':
      return { command: 'shutdown -r +1 "Neustart durch Vulpexa in einer Minute"', shell: 'bash' };
    case 'darwin':
      return { command: 'shutdown -r +1', shell: 'zsh' };
    default:
      return null;
  }
}
