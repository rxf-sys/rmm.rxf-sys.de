import { useEffect } from 'react';

/** A two-key "go to" sequence: g then the letter. */
export interface GoShortcut {
  key: string;
  path: string;
  label: string;
}

function typingInField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * Global keyboard shortcuts: ⌘K / Strg+K for the command palette, "?" for the
 * shortcut list, and g-sequences to jump between pages. Nothing fires while
 * the user is typing in a field or a dialog is open.
 */
export function useShortcuts(opts: {
  enabled: boolean;
  go: GoShortcut[];
  onNavigate: (path: string) => void;
  onPalette: () => void;
  onHelp: () => void;
}): void {
  const { enabled, go, onNavigate, onPalette, onHelp } = opts;
  useEffect(() => {
    if (!enabled) return;
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        onHelp();
        return;
      }
      const now = Date.now();
      if (e.key === 'g') {
        pendingG = now;
        return;
      }
      if (pendingG && now - pendingG < 1200) {
        const hit = go.find((s) => s.key === e.key);
        pendingG = 0;
        if (hit) {
          e.preventDefault();
          onNavigate(hit.path);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, go, onNavigate, onPalette, onHelp]);
}
