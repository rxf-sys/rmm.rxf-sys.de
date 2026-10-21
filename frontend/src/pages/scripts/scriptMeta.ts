/** Labels and filters of the script library. */
import type { Script, ScriptCategory, ScriptOs, Shell } from '../../types';

export const CATEGORY_LABEL: Record<ScriptCategory, string> = {
  wartung: 'Wartung',
  sicherheit: 'Sicherheit',
  diagnose: 'Diagnose',
  sonstiges: 'Sonstiges',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ScriptCategory[];

export const OS_LABEL: Record<ScriptOs, string> = {
  windows: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
  any: 'Alle Systeme',
};

/** 'fav' is not a category: it is the one cross-cutting shelf, so it sits
 *  in the same control instead of a second toggle next to it. */
export type CatFilter = 'alle' | 'fav' | ScriptCategory;
export type OsFilter = 'all' | ScriptOs;

export interface Draft {
  id: number | null;
  name: string;
  shell: Shell;
  os: ScriptOs;
  category: ScriptCategory;
  danger: boolean;
  content: string;
}

export const EMPTY_DRAFT: Draft = { id: null, name: '', shell: 'bash', os: 'any', category: 'sonstiges', danger: false, content: '' };

export function matchesScript(s: Script, f: { q: string; os: OsFilter; cat: CatFilter; favorites: number[] }): boolean {
  if (f.os !== 'all' && s.os !== f.os) return false;
  if (f.cat === 'fav' && !f.favorites.includes(s.id)) return false;
  if (f.cat !== 'alle' && f.cat !== 'fav' && s.category !== f.cat) return false;
  const q = f.q.trim().toLowerCase();
  return !q || s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
}

/** The shell a script for that system runs in, when none was chosen yet. */
export function defaultShell(os: ScriptOs): Shell {
  return os === 'windows' ? 'powershell' : os === 'darwin' ? 'zsh' : 'bash';
}
