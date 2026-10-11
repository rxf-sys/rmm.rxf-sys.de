/**
 * What the command palette lists for a query — pure, so the ordering rules
 * are tested without rendering anything.
 *
 * Empty query: recently opened devices, the actions, every page the role may
 * open. With a query: actions, pages and devices that match, each group
 * sorted by score and the groups ordered by their best hit, so typing a full
 * hostname puts that device first even though pages usually lead. The top
 * device also gets quick targets straight into its most used tabs.
 */

import { isAgent } from '../../deviceClass';
import { visibleTabs } from '../../pages/device/deviceTabs';
import type { PageId } from '../../routes';
import type { Device, Role } from '../../types';
import { visibleGroups } from '../nav';
import { normalize, rankDevices, scoreQuery, termScore, type DeviceEntry, type Field } from './ranking';

export type ActionId = 'enroll' | 'theme';
export type QuickTab = 'remote' | 'patches' | 'jobs';
export type GroupId = 'recent' | 'actions' | 'pages' | 'devices';

export type PaletteOption =
  | { kind: 'action'; key: string; action: ActionId; label: string }
  | { kind: 'page'; key: string; page: PageId; label: string }
  | { kind: 'device'; key: string; device: Device; showId: boolean; tag: string | null }
  | { kind: 'quick'; key: string; device: Device; tab: QuickTab; label: string };

type DeviceOption = Extract<PaletteOption, { kind: 'device' }>;

export interface PaletteGroup {
  id: GroupId;
  label: string;
  options: PaletteOption[];
}

export interface PaletteModel {
  groups: PaletteGroup[];
  /** Rows the query found — quick targets are not hits of their own. */
  hits: number;
  /** Matching devices; at most MAX_DEVICE_ROWS of them are listed. */
  devicesTotal: number;
  devicesShown: number;
}

export const GROUP_LABEL: Record<GroupId, string> = {
  recent: 'Zuletzt geöffnet',
  actions: 'Aktionen',
  pages: 'Seiten',
  devices: 'Geräte',
};

/** App passes `canEnroll` as its operator signal (admin or techniker). */
export function roleOf(isAdmin: boolean, canEnroll: boolean): Role {
  return isAdmin ? 'admin' : canEnroll ? 'techniker' : 'viewer';
}

interface Command<T> {
  id: T;
  label: string;
  /** Other words people use for it; they match, but weaker than the label. */
  keywords: string[];
}

const ACTIONS: (Command<ActionId> & { operatorOnly: boolean })[] = [
  {
    id: 'enroll',
    label: 'Gerät hinzufügen',
    keywords: ['Neues Gerät', 'Agent installieren', 'Enrollment', 'Token'],
    operatorOnly: true,
  },
  { id: 'theme', label: 'Design wechseln', keywords: ['Theme', 'Hell', 'Dunkel', 'Dark Mode', 'Farbschema'], operatorOnly: false },
];

const PAGE_KEYWORDS: Record<PageId, string[]> = {
  overview: ['Start', 'Dashboard', 'Lage'],
  devices: ['Rechner', 'Computer', 'Flotte'],
  persons: ['Mitarbeiter', 'Benutzer'],
  alerts: ['Alarme', 'Warnungen'],
  patches: ['Updates', 'Patch-Management'],
  scripts: ['Skript-Bibliothek'],
  automation: ['Zeitpläne', 'Regeln'],
  docs: ['Hilfe', 'Handbuch'],
  audit: ['Protokoll', 'Log'],
  admin: ['Einstellungen', 'Konten'],
};

const QUICK: { tab: QuickTab; label: string; operatorOnly: boolean }[] = [
  // Viewers see the remote tab (it carries the RustDesk id), but the
  // terminal in it is operator work — offering it would lead to a refusal.
  { tab: 'remote', label: 'Terminal', operatorOnly: true },
  { tab: 'patches', label: 'Updates', operatorOnly: false },
  // Job output can hold secrets; the API serves it to operators only.
  { tab: 'jobs', label: 'Aktivität', operatorOnly: true },
];

/** The tabs the palette can jump to on this device for this role. They
 *  follow the device page's own rules, so a phone (no agent) gets none. */
export function quickTargets(device: Device, role: Role): { tab: QuickTab; label: string }[] {
  const operator = role !== 'viewer';
  const tabs = visibleTabs({ isAdmin: role === 'admin', isOperator: operator, agent: isAgent(device) });
  return QUICK.filter((q) => (!q.operatorOnly || operator) && tabs.some((t) => t.id === q.tab));
}

function rankCommands<T>(commands: Command<T>[], query: string): { cmd: Command<T>; score: number }[] {
  return commands
    .map((cmd) => {
      const fields: Field[] = [
        { text: normalize(cmd.label), weight: 2 },
        ...cmd.keywords.map((k) => ({ text: normalize(k), weight: 1 })),
      ];
      return { cmd, score: scoreQuery(query, (t) => termScore(fields, t)) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

const actionOption = (a: Command<ActionId>): PaletteOption => ({
  kind: 'action',
  key: `action-${a.id}`,
  action: a.id,
  label: a.label,
});
const pageOption = (p: Command<PageId>): PaletteOption => ({ kind: 'page', key: `page-${p.id}`, page: p.id, label: p.label });
const deviceOption = (e: DeviceEntry, tag: string | null): DeviceOption => ({
  kind: 'device',
  key: `device-${e.device.id}`,
  device: e.device,
  showId: e.showId,
  tag,
});

/** Inserts the quick targets right below the first device row. */
function withQuickTargets(groups: PaletteGroup[], role: Role): PaletteGroup[] {
  let placed = false;
  return groups.map((g) => {
    if (placed) return g;
    const at = g.options.findIndex((o) => o.kind === 'device');
    const top = g.options[at];
    if (!top || top.kind !== 'device') return g;
    placed = true;
    const quick: PaletteOption[] = quickTargets(top.device, role).map((q) => ({
      kind: 'quick',
      key: `quick-${top.device.id}-${q.tab}`,
      device: top.device,
      tab: q.tab,
      label: q.label,
    }));
    return { ...g, options: [...g.options.slice(0, at + 1), ...quick, ...g.options.slice(at + 1)] };
  });
}

export interface PaletteInput {
  query: string;
  index: readonly DeviceEntry[];
  /** Device ids, newest first (see recent.ts). */
  recent: readonly number[];
  role: Role;
}

export function buildPalette({ query, index, recent, role }: PaletteInput): PaletteModel {
  const operator = role !== 'viewer';
  const actions = ACTIONS.filter((a) => !a.operatorOnly || operator);
  const pages: Command<PageId>[] = visibleGroups(role)
    .flatMap((g) => g.items)
    .map((i) => ({ id: i.id, label: i.label, keywords: PAGE_KEYWORDS[i.id] }));

  let groups: PaletteGroup[];
  let devicesTotal = 0;
  let devicesShown = 0;

  if (!normalize(query).trim()) {
    const byId = new Map(index.map((e) => [e.device.id, e]));
    // Recent ids of devices that are gone (or no longer visible to this
    // person) simply drop out.
    const recentEntries = recent.flatMap((id) => byId.get(id) ?? []);
    groups = [
      { id: 'recent', label: GROUP_LABEL.recent, options: recentEntries.map((e) => deviceOption(e, null)) },
      { id: 'actions', label: GROUP_LABEL.actions, options: actions.map(actionOption) },
      { id: 'pages', label: GROUP_LABEL.pages, options: pages.map(pageOption) },
    ];
  } else {
    const foundActions = rankCommands(actions, query);
    const foundPages = rankCommands(pages, query);
    const devices = rankDevices(index, query);
    devicesTotal = devices.total;
    devicesShown = devices.hits.length;
    const ranked: { best: number; group: PaletteGroup }[] = [
      {
        best: foundActions[0]?.score ?? 0,
        group: { id: 'actions', label: GROUP_LABEL.actions, options: foundActions.map((r) => actionOption(r.cmd)) },
      },
      {
        best: foundPages[0]?.score ?? 0,
        group: { id: 'pages', label: GROUP_LABEL.pages, options: foundPages.map((r) => pageOption(r.cmd)) },
      },
      {
        best: devices.hits[0]?.score ?? 0,
        group: { id: 'devices', label: GROUP_LABEL.devices, options: devices.hits.map((h) => deviceOption(h.entry, h.tag)) },
      },
    ];
    // Best group first; on a tie the order above holds (the sort is stable).
    groups = ranked.sort((a, b) => b.best - a.best).map((r) => r.group);
  }

  groups = withQuickTargets(
    groups.filter((g) => g.options.length > 0),
    role,
  );
  const hits = groups.reduce((n, g) => n + g.options.filter((o) => o.kind !== 'quick').length, 0);
  return { groups, hits, devicesTotal, devicesShown };
}

const fmt = new Intl.NumberFormat('de-DE');

/** The line a screen reader hears after each keystroke, also shown in the
 *  footer. Empty while nothing is searched. */
export function statusText(model: PaletteModel, query: string): string {
  if (!normalize(query).trim()) return '';
  if (model.hits === 0) return 'Keine Treffer';
  if (model.devicesTotal > model.devicesShown)
    return `${fmt.format(model.devicesShown)} von ${fmt.format(model.devicesTotal)} Geräten gezeigt — Suche eingrenzen`;
  return `${fmt.format(model.hits)} Treffer`;
}
