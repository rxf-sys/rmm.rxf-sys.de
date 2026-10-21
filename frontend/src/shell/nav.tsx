import type { ReactNode } from 'react';
import {
  IconBell,
  IconBook,
  IconClock,
  IconGrid,
  IconList,
  IconMonitor,
  IconSettings,
  IconShield,
  IconTerminal,
  IconUsers,
} from '../icons';
import type { GoShortcut } from '../hooks/useShortcuts';
import { PAGE_LABEL, PAGE_PATH, type PageId } from '../routes';
import type { Role } from '../types';

export interface NavItem {
  id: PageId;
  label: string;
  path: string;
  icon: ReactNode;
  /** Roles that see the entry; absent = everyone. */
  roles?: Role[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const item = (id: PageId, icon: ReactNode, roles?: Role[]): NavItem => ({
  id,
  label: PAGE_LABEL[id],
  path: PAGE_PATH[id],
  icon,
  roles,
});

/** The navigation, grouped by what the visitor is doing. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Betrieb',
    items: [
      item('overview', <IconGrid size={16} />),
      item('devices', <IconMonitor size={16} />),
      item('alerts', <IconBell size={16} />),
      item('patches', <IconShield size={16} />),
    ],
  },
  {
    label: 'Werkzeuge',
    items: [
      // Skript-Bodies können Secrets enthalten — die API liefert sie nur für
      // Admin/Techniker, also den Eintrag für Betrachter gar nicht anbieten.
      item('scripts', <IconTerminal size={16} />, ['admin', 'techniker']),
      item('automation', <IconClock size={16} />),
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      item('persons', <IconUsers size={16} />),
      item('audit', <IconList size={16} />, ['admin']),
      item('admin', <IconSettings size={16} />, ['admin']),
      item('docs', <IconBook size={16} />),
    ],
  },
];

export function visibleGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** The letter after "g" that jumps to a page. */
const GO_KEY: Partial<Record<PageId, string>> = {
  overview: 'o',
  devices: 'd',
  alerts: 'a',
  patches: 'p',
  scripts: 's',
  automation: 'u',
  audit: 'l',
};

/** The go-to shortcuts of the pages the role sees in the navigation, in its
 *  order. Built from the same list, so a jump never lands on "Kein Zugriff". */
export function goShortcutsFor(role: Role): GoShortcut[] {
  return visibleGroups(role)
    .flatMap((g) => g.items)
    .flatMap((i) => {
      const key = GO_KEY[i.id];
      return key ? [{ key, path: i.path, label: i.label }] : [];
    });
}
