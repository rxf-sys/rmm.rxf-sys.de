/** Auf welchen Geräten ein Bibliotheksskript laufen darf.
 *
 * Liegt außerhalb der Seiten, weil zwei Stellen dieselbe Frage stellen: die
 * Bibliothek beim Zielgerät und der Remote-Reiter beim Skript. Vorher bot
 * der Remote-Reiter jedes Skript auf jedem Gerät an — auch PowerShell auf
 * einem Linux-Server.
 */

import type { ScriptOs } from './types';

export const SCRIPT_OS_LABEL: Record<ScriptOs, string> = {
  windows: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
  any: 'Alle',
};

export function osMatchesDevice(scriptOs: ScriptOs, deviceOs: string): boolean {
  return scriptOs === 'any' || scriptOs === deviceOs;
}

/** Welche Shells auf diesem Betriebssystem überhaupt existieren. Vorher stand
 *  `powershell` auch auf einem Linux-Gerät zur Wahl — der Job wäre erst auf
 *  dem Gerät gescheitert. */
export function shellsFor(deviceOs: string): ('bash' | 'zsh' | 'powershell')[] {
  if (deviceOs === 'windows') return ['powershell'];
  if (deviceOs === 'darwin') return ['zsh', 'bash'];
  return ['bash', 'zsh'];
}
