import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** What the user asked for. 'system' follows the OS and is the default. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is actually on screen. */
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'vulpexa-theme-pref';
// Older builds stored the *current* theme on every load, so a stored 'dark'
// says nothing about a deliberate choice. They are cleared, not migrated.
const STALE_KEYS = ['vulpexa-theme', 'ryntra-theme'];
const DARK_QUERY = '(prefers-color-scheme: dark)';
// Must match --bg in tokens.css; the browser chrome on phones takes this colour.
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#f6f5f2', dark: '#111219' };

/** Neither reading nor writing may throw: private windows and blocked site
 *  data make localStorage throw on access, and a colour preference is no
 *  reason to take the whole interface down. */
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
    for (const k of STALE_KEYS) localStorage.removeItem(k);
  } catch {
    // The choice then lasts until reload.
  }
}

function subscribeSystem(onChange: () => void): () => void {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener?.('change', onChange);
  return () => mq?.removeEventListener?.('change', onChange);
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? true;
}

/** Applies a preference to the document: data-theme for explicit choices,
 *  no attribute for 'system' (the CSS media query decides), and the
 *  theme-color metas so the phone's status bar matches the page. */
export function applyTheme(pref: ThemePreference, resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    meta.content =
      pref === 'system' && media
        ? THEME_COLOR[media.includes('dark') ? 'dark' : 'light']
        : THEME_COLOR[resolved];
  }
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** Cycles light ↔ dark from whatever is on screen (command palette). */
  toggle: () => void;
} {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => true);
  const resolved: ResolvedTheme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyTheme(preference, resolved);
  }, [preference, resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    writePreference(p);
    setPref(p);
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  return { preference, resolved, setPreference, toggle };
}
