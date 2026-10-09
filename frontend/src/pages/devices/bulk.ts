/**
 * Bulk actions run as one request per device against the same endpoints a
 * single device uses. That keeps every permission check and every audit
 * record exactly where it already is: twelve restarts are twelve
 * `job.created` entries, each with its device.
 */
import { isAgent } from '../../deviceClass';
import type { Device, Shell } from '../../types';

export interface BulkOutcome<T> {
  ok: T[];
  failed: { item: T; error: unknown }[];
}

/** Run `fn` for every item, a few at a time, and collect what failed instead
 *  of stopping at the first error — one unreachable device must not leave
 *  the other eleven untouched. */
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 4,
): Promise<BulkOutcome<T>> {
  const out: BulkOutcome<T> = { ok: [], failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
        out.ok.push(item);
      } catch (error) {
        out.failed.push({ item, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

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

/** Can a job reach this device right now? Jobs are not queued: the server
 *  fails one for a device without a live connection on the spot. */
export function reachable(d: Device): boolean {
  return isAgent(d) && d.connected;
}

/** Split a selection into the devices an action applies to and a sentence
 *  about the rest, so a dialog can say up front what will be skipped. */
export function partition(
  devices: Device[],
  rules: { test: (d: Device) => boolean; reason: string }[],
): { targets: Device[]; skipped: { reason: string; count: number }[] } {
  const targets: Device[] = [];
  const counts = new Map<string, number>();
  for (const d of devices) {
    const failed = rules.find((r) => !r.test(d));
    if (failed) counts.set(failed.reason, (counts.get(failed.reason) ?? 0) + 1);
    else targets.push(d);
  }
  return { targets, skipped: Array.from(counts, ([reason, count]) => ({ reason, count })) };
}

/** "2 ohne Verbindung, 1 anderes Betriebssystem" */
export function skippedText(skipped: { reason: string; count: number }[]): string {
  return skipped.map((s) => `${s.count} ${s.reason}`).join(', ');
}
