import { useMemo, useState } from 'react';

/** 'alle' renders everything — kept as an explicit option because some lists
 *  (a small script library, one person's devices) are nicer unpaginated. */
export type PageSize = 25 | 50 | 100 | 'alle';

export const PAGE_SIZES: PageSize[] = [25, 50, 100, 'alle'];

const DEFAULT_SIZE: PageSize = 25;

const storageKey = (list: string) => `vulpexa-pagesize-${list}`;

function loadSize(list: string): PageSize {
  try {
    const raw = localStorage.getItem(storageKey(list));
    if (raw === 'alle') return 'alle';
    const n = Number(raw);
    return PAGE_SIZES.includes(n as PageSize) ? (n as PageSize) : DEFAULT_SIZE;
  } catch {
    // Private mode, cleared site data, or a browser that blocks storage —
    // the default is a perfectly good answer, so never let this throw.
    return DEFAULT_SIZE;
  }
}

export interface PaginationState<T> {
  /** The slice to render. */
  items: T[];
  /** 1-based. */
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  /** 1-based index of the first shown item, 0 when the list is empty. */
  from: number;
  /** 1-based index of the last shown item. */
  to: number;
  setPage: (p: number) => void;
  setPageSize: (s: PageSize) => void;
}

/**
 * Client-side pagination with a per-list, per-browser page size.
 *
 * `resetKey` is whatever narrows the list — the active filter, the search
 * text. When it changes the view jumps back to page 1: staying on page 4 of a
 * result set the user just replaced shows them an arbitrary middle of it, or
 * an empty page.
 *
 * The page is also clamped to the current page count, so a list that shrinks
 * under a running poll (a device goes offline and drops out of a filter)
 * cannot strand the view past the end.
 */
export function usePagination<T>(items: T[], list: string, resetKey = ''): PaginationState<T> {
  const [pageSize, setSizeState] = useState<PageSize>(() => loadSize(list));
  const [page, setPage] = useState(1);

  // Reset during render rather than in an effect: an effect would paint one
  // frame of the wrong page first.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setPage(1);
  }

  const total = items.length;
  const size = pageSize === 'alle' ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);

  const setPageSize = (s: PageSize) => {
    setSizeState(s);
    setPage(1);
    try {
      localStorage.setItem(storageKey(list), String(s));
    } catch {
      // Not being able to remember the choice is not a reason to reject it.
    }
  };

  const slice = useMemo(
    () => items.slice((current - 1) * size, current * size),
    [items, current, size],
  );

  return {
    items: slice,
    page: current,
    pageCount,
    pageSize,
    total,
    from: total === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(current * size, total),
    setPage,
    setPageSize,
  };
}
