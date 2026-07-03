/** Shared formatting helpers. */

export function formatRelative(ts: number | null): string {
  if (!ts) return 'nie';
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (delta < 90) return 'gerade eben';
  if (delta < 3600) return `vor ${Math.floor(delta / 60)} min`;
  if (delta < 86400) return `vor ${Math.floor(delta / 3600)} h`;
  return new Date(ts * 1000).toLocaleString('de-DE');
}

export function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('de-DE');
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const OS_LABEL: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
};

export function osLabel(os: string): string {
  return OS_LABEL[os] ?? os;
}
