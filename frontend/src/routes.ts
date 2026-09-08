import type { PageId } from './components/Sidebar';

/**
 * The URL is the source of truth for navigation.
 *
 * Before routing existed, the current page lived in `useState`: a reload always
 * landed on the overview, the browser's back button left the app entirely, and
 * a device page could not be bookmarked or shared. `PageId` stays as the
 * vocabulary the sidebar and the command palette already speak; this module is
 * the single mapping between it and the path.
 */
export const PAGE_PATH: Record<PageId, string> = {
  overview: '/',
  devices: '/devices',
  persons: '/personen',
  alerts: '/alarme',
  patches: '/patches',
  scripts: '/skripte',
  automation: '/automatisierung',
  docs: '/doku',
  audit: '/audit',
  admin: '/administration',
};

export const PAGE_LABEL: Record<PageId, string> = {
  overview: 'Übersicht',
  devices: 'Geräte',
  persons: 'Personen',
  alerts: 'Alarm-Center',
  patches: 'Patch-Management',
  scripts: 'Skripte',
  automation: 'Automatisierung',
  docs: 'Dokumentation',
  audit: 'Audit-Log',
  admin: 'Administration',
};

const PATH_PAGE = new Map<string, PageId>(
  (Object.entries(PAGE_PATH) as [PageId, string][]).map(([id, path]) => [path, id]),
);

/** Which sidebar entry to highlight for a pathname. Device pages count as
 *  "devices" so the section stays marked while a device is open. */
export function pageForPath(pathname: string): PageId {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const direct = PATH_PAGE.get(clean);
  if (direct) return direct;
  if (clean.startsWith('/devices')) return 'devices';
  return 'overview';
}

export function devicePath(id: number): string {
  return `${PAGE_PATH.devices}/${id}`;
}
