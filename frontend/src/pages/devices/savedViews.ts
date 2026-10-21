import { useCallback, useState } from 'react';

/**
 * A saved view is a named query string: everything that shapes the device
 * list (filter, person, search, sort) already lives in the URL, so a view is
 * just a way back to one. Stored per browser — views are a personal
 * shortcut, not shared configuration.
 */
export interface SavedView {
  id: string;
  name: string;
  /** Search params without the leading "?", e.g. "filter=probleme&sort=-disk". */
  query: string;
}

const KEY = 'vulpexa-device-views';
const MAX_VIEWS = 12;

function isView(v: unknown): v is SavedView {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.query === 'string';
}

export function loadViews(): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isView).slice(0, MAX_VIEWS) : [];
  } catch {
    // Blocked storage or a hand-edited value: no views is a fine answer.
    return [];
  }
}

function storeViews(views: SavedView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    // Private mode: the view still works for this session.
  }
}

/** The query a view stores: only the parameters that shape the list. */
export function viewQuery(params: URLSearchParams): string {
  const keep = new URLSearchParams();
  for (const k of ['filter', 'person', 'q', 'sort']) {
    const v = params.get(k);
    if (v) keep.set(k, v);
  }
  return keep.toString();
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(loadViews);

  const save = useCallback((name: string, query: string) => {
    setViews((prev) => {
      // Same name replaces: saving "Server mit Updates" twice updates it.
      const rest = prev.filter((v) => v.name.toLowerCase() !== name.toLowerCase());
      const next = [...rest, { id: `${Date.now().toString(36)}${rest.length}`, name, query }].slice(-MAX_VIEWS);
      storeViews(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      storeViews(next);
      return next;
    });
  }, []);

  return { views, save, remove };
}
