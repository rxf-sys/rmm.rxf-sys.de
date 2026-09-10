import { PAGE_SIZES, type PageSize } from '../hooks/usePagination';

interface Props {
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  from: number;
  to: number;
  setPage: (p: number) => void;
  setPageSize: (s: PageSize) => void;
  /** Plural noun for the rows, e.g. "Geräte". Used for the accessible names. */
  label: string;
}

/** First, last, and a window around the current page — with gaps marked so a
 *  1000-page list does not render 1000 buttons. */
function pageNumbers(current: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(count - 1, current + 1);
  if (start > 2) out.push('gap');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < count - 1) out.push('gap');
  out.push(count);
  return out;
}

/**
 * The footer of a paginated list: how much is shown, how much there is, how
 * big a page should be, and where to go next.
 *
 * Rendered only when it has something to offer — a list that fits on one
 * default-sized page gets nothing, so short lists keep their quiet layout.
 * A list longer than the smallest page size keeps the bar even when the user
 * has switched to "alle", because that is the control they need to switch
 * back.
 */
export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  from,
  to,
  setPage,
  setPageSize,
  label,
}: Props) {
  if (pageCount <= 1 && total <= 25) return null;

  return (
    <div className="pager">
      <span className="pager-range">
        {total === 0 ? 'Keine Einträge' : `${from}–${to} von ${total}`}
      </span>

      <label className="pager-size">
        <span className="muted">pro Seite</span>
        <select
          className="input btn-sm"
          style={{ padding: '4px 7px' }}
          value={String(pageSize)}
          onChange={(e) =>
            setPageSize(e.target.value === 'alle' ? 'alle' : (Number(e.target.value) as PageSize))
          }
          aria-label={`${label} pro Seite`}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={String(s)}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {pageCount > 1 && (
        <nav className="pager-nav" aria-label={`Seiten (${label})`}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            aria-label="Vorherige Seite"
          >
            ‹
          </button>
          {pageNumbers(page, pageCount).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={p === page ? 'btn btn-sm btn-accent' : 'btn btn-sm'}
                onClick={() => setPage(p)}
                aria-label={`Seite ${p}`}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPage(page + 1)}
            disabled={page >= pageCount}
            aria-label="Nächste Seite"
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
