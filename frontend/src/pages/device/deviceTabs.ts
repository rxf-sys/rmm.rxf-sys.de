/** The tabs of a device page and who sees which. */

export type TabId =
  | 'overview'
  | 'history'
  | 'inventory'
  | 'remote'
  | 'patches'
  | 'passwords'
  | 'diagnostics'
  | 'jobs';

/** `agentOnly`: the tab lives on data only an agent reports. On a phone it
 *  would stay empty forever, so it is not shown at all. */
export const TABS: {
  id: TabId;
  label: string;
  adminOnly?: boolean;
  operatorOnly?: boolean;
  agentOnly?: boolean;
}[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'history', label: 'Verlauf', agentOnly: true },
  { id: 'inventory', label: 'Inventar', agentOnly: true },
  // Remote desktop, terminal and installs are operator actions; a viewer
  // would only find a tab that refuses them.
  { id: 'remote', label: 'Fernzugriff', operatorOnly: true, agentOnly: true },
  { id: 'patches', label: 'Updates', agentOnly: true },
  // Job commands and output can hold secrets; the API is operator-only.
  { id: 'jobs', label: 'Aktivität', operatorOnly: true, agentOnly: true },
  { id: 'diagnostics', label: 'Diagnose', operatorOnly: true, agentOnly: true },
  { id: 'passwords', label: 'Passwörter', adminOnly: true },
];

export const TAB_IDS = TABS.map((t) => t.id);

export function visibleTabs(opts: { isAdmin: boolean; isOperator: boolean; agent: boolean }) {
  return TABS.filter(
    (t) => (!t.adminOnly || opts.isAdmin) && (!t.operatorOnly || opts.isOperator) && (!t.agentOnly || opts.agent),
  );
}
