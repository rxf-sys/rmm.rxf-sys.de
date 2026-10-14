import './devices.css';
import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { Pagination } from '../../components/Pagination';
import { isAgent, ownershipLabel } from '../../deviceClass';
import { deviceStatusKind, deviceStatusLabel, loadLevel, type LoadKind } from '../../deviceStatus';
import { formatAgo, formatDateTime, osLabel } from '../../format';
import { usePagination } from '../../hooks/usePagination';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconMonitor,
  IconPlus,
  IconSearch,
  IconShield,
  IconSort,
  IconUpgrade,
  OsIcon,
} from '../../icons';
import type { Device, PatchSummary, Person } from '../../types';
import { EmptyState, ErrorNote, PageHeader, SkeletonRows, StatusBadge } from '../../ui';
import { BulkBar } from './BulkBar';
import {
  FILTER_LABEL,
  FILTERS,
  csvFileName,
  diskPct,
  formatSort,
  isFilter,
  lastSeen,
  livePct,
  matchesFilter,
  nextSort,
  ownerOf,
  parseSort,
  sortDevices,
  toCsv,
  type Filter,
  type ListContext,
  type Sort,
  type SortKey,
} from './deviceList';
import { useSavedViews, viewQuery } from './savedViews';
import { SoftwareSearch } from './SoftwareSearch';
import { ViewsPopover } from './ViewsPopover';
import { downloadCsv } from '../../csv';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  loading: boolean;
  /** The list failed before it ever arrived: `devices` is then empty
   *  because nothing is known, not because there is nothing. */
  loadError?: unknown;
  onRetry?: () => void;
  /** Admin or Techniker: selection and bulk actions. */
  canOperate: boolean;
  onOpenEnroll?: () => void;
}

/** "Alle" on a fleet of thousands would put tens of thousands of nodes in the
 *  page; past this many rows the list asks for a filter instead. */
const RENDER_CAP = 500;

/** Below this the rail leaves the table too little room for its columns;
 *  the list becomes cards. Matches devices.css. */
const CARDS_QUERY = '(max-width: 1000px)';

const fmt = new Intl.NumberFormat('de-DE');
const now = () => Math.floor(Date.now() / 1000);

const FILTER_TONE: Partial<Record<Filter, FilterOption<Filter>['tone']>> = {
  probleme: 'danger',
  offline: 'warn',
  ok: 'ok',
};

/** A load figure with a short bar. Colour only once a threshold is crossed;
 *  the number always carries the reading. */
function Load({ pct, kind }: { pct: number | null; kind: LoadKind }) {
  if (pct === null) return <span className="dl-none">—</span>;
  const v = Math.round(Math.max(0, Math.min(100, pct)));
  return (
    <span className={`mm lvl-${loadLevel(v, kind)}`}>
      <span className="mm-val num">{v} %</span>
      <span className="mm-track" aria-hidden>
        <span style={{ width: `${v}%` }} />
      </span>
    </span>
  );
}

function Updates({ d, summary }: { d: Device; summary: PatchSummary }) {
  const p = summary[String(d.id)];
  if (!p || !isAgent(d)) return <span className="dl-none">—</span>;
  if (p.pending === 0) return <span className="dl-quiet">aktuell</span>;
  return (
    <span className="upd" title={p.security > 0 ? `${p.pending} ausstehend, davon ${p.security} sicherheitsrelevant` : `${p.pending} ausstehend`}>
      <span className="num">{fmt.format(p.pending)}</span>
      {p.security > 0 && (
        <span className="upd-sec">
          <IconShield size={12} />
          <span className="num">{fmt.format(p.security)}</span>
          <span className="sr-only"> sicherheitsrelevant</span>
        </span>
      )}
    </span>
  );
}

function AgentVersion({ d }: { d: Device }) {
  if (!isAgent(d)) return <span className="dl-none">—</span>;
  return (
    <span className="agentv num">
      {d.agent_version || '—'}
      {d.agent_update_available && (
        <span className="agentv-up" title={`Version ${d.agent_update_available} verfügbar`}>
          <IconUpgrade size={13} />
          <span className="sr-only">, Update auf {d.agent_update_available} verfügbar</span>
        </span>
      )}
    </span>
  );
}

function Seen({ d }: { d: Device }) {
  const ts = lastSeen(d);
  const title = ts ? formatDateTime(ts) : undefined;
  if (!isAgent(d))
    return (
      <span className="dl-quiet" title={title}>
        {ts ? `geprüft ${formatAgo(ts)}` : '—'}
      </span>
    );
  return (
    <span className={d.online ? 'dl-quiet' : 'dl-quiet dl-off'} title={title}>
      {formatAgo(ts)}
    </span>
  );
}

function Subline({ d }: { d: Device }) {
  // The reported version usually names the system already ("Debian
  // GNU/Linux 12", "Windows 11 Pro"); the label is the fallback.
  const os = d.os_version || osLabel(d.os);
  const extra = isAgent(d) ? '' : [ownershipLabel(d), d.model].filter(Boolean).join(' · ');
  return (
    <span className="dl-sub">
      <span className="dl-os">{[os, extra].filter(Boolean).join(' · ')}</span>
      {d.tags.slice(0, 2).map((t) => (
        <span key={t} className="chip dl-tag">
          {t}
        </span>
      ))}
      {d.tags.length > 2 && (
        <span className="dl-quiet dl-more" title={d.tags.slice(2).join(', ')}>
          +{d.tags.length - 2}
        </span>
      )}
    </span>
  );
}

function StatusCell({ d }: { d: Device }) {
  const inMaintenance = d.maintenance_until !== null && d.maintenance_until > now();
  return (
    <span className="dl-status">
      <StatusBadge kind={deviceStatusKind(d)} label={deviceStatusLabel(d)} />
      {inMaintenance && (
        <span className="chip" title={`Wartung bis ${new Date(d.maintenance_until! * 1000).toLocaleString('de-DE')}`}>
          Wartung
        </span>
      )}
    </span>
  );
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Gerät', className: 'c-name' },
  { key: 'status', label: 'Status', className: 'c-status' },
  { key: 'person', label: 'Person', className: 'c-person' },
  { key: 'cpu', label: 'CPU', className: 'c-load c-cpu' },
  { key: 'ram', label: 'RAM', className: 'c-load c-ram' },
  { key: 'disk', label: 'Disk', className: 'c-load c-disk' },
  { key: 'updates', label: 'Updates', className: 'c-upd' },
  { key: 'agent', label: 'Agent', className: 'c-agent' },
  { key: 'seen', label: 'Zuletzt', className: 'c-seen' },
];

function SortHeader({ col, sort, onSort }: { col: (typeof COLUMNS)[number]; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      className={col.className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className={active ? 'th-sort active' : 'th-sort'} onClick={() => onSort(col.key)}>
        {col.label}
        <span className={active ? 'th-ico active' : 'th-ico'} aria-hidden>
          {!active ? <IconSort size={12} /> : sort.dir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
        </span>
      </button>
    </th>
  );
}

export function DevicesPage({ devices, patchSummary, persons, loading, loadError, onRetry, canOperate, onOpenEnroll }: Props) {
  // Everything that shapes the list lives in the URL: the overview links
  // straight to "Probleme", a reload keeps the view, a saved view is just a
  // query string, and a colleague gets the same list from a pasted link.
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('filter');
  const filter: Filter = isFilter(rawFilter) ? rawFilter : 'alle';
  // The search text is component state and only written to the URL: React
  // Router applies URL changes in a transition, so an input controlled by
  // the URL drops keystrokes when someone types fast.
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const rawSort = params.get('sort');
  const sort = useMemo(() => parseSort(rawSort), [rawSort]);
  const rawPerson = params.get('person');
  const personFilter = rawPerson !== null && persons.some((p) => String(p.id) === rawPerson) ? Number(rawPerson) : null;

  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const personNames = useMemo(() => new Map(persons.map((p) => [p.id, p.name])), [persons]);
  const ctx: ListContext = useMemo(
    () => ({ patchSummary, personName: (id) => (id === null ? '' : (personNames.get(id) ?? '')) }),
    [patchSummary, personNames],
  );

  // Search and person narrow the set the filter chips count over, so their
  // numbers describe what clicking would actually show.
  const base = useMemo(() => {
    const query = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (personFilter !== null && d.person_id !== personFilter) return false;
      if (!query) return true;
      const hay = `${d.hostname} ${ownerOf(d, ctx)} ${d.owner_label} ${d.tags.join(' ')} ${osLabel(d.os)} ${d.model}`;
      return hay.toLowerCase().includes(query);
    });
  }, [devices, ctx, q, personFilter]);

  const shown = useMemo(
    () => sortDevices(base.filter((d) => matchesFilter(d, filter)), sort, ctx),
    [base, filter, sort, ctx],
  );
  const pager = usePagination(shown, 'devices', `${filter}|${personFilter}|${q.trim()}|${sort.key}|${sort.dir}`);
  const rows = pager.items.length > RENDER_CAP ? pager.items.slice(0, RENDER_CAP) : pager.items;

  const filterOptions: FilterOption<Filter>[] = useMemo(
    () =>
      FILTERS.map((id) => ({
        id,
        label: FILTER_LABEL[id],
        count: id === 'alle' ? undefined : base.filter((d) => matchesFilter(d, id)).length,
        tone: FILTER_TONE[id] ?? 'neutral',
      })),
    [base],
  );

  // ---- selection ----
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  // Devices that disappeared (deleted, out of a viewer's scope) drop out of
  // the selection by themselves.
  const selectedDevices = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);
  const shownIds = useMemo(() => new Set(shown.map((d) => d.id)), [shown]);
  const hiddenSelected = selectedDevices.filter((d) => !shownIds.has(d.id)).length;
  const pageAll = rows.length > 0 && rows.every((d) => selected.has(d.id));
  const pageSome = rows.some((d) => selected.has(d.id));

  const toggle = (id: number, e: ChangeEvent<HTMLInputElement>) => {
    // A checkbox changes on click, so the native event knows about Shift.
    const shift = (e.nativeEvent as globalThis.MouseEvent).shiftKey === true;
    const index = rows.findIndex((d) => d.id === id);
    const on = !selected.has(id);
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift-click selects the run between the last click and this one.
      const from = shift && anchor !== null ? rows.findIndex((d) => d.id === anchor) : -1;
      const ids = from >= 0 ? rows.slice(Math.min(from, index), Math.max(from, index) + 1).map((d) => d.id) : [id];
      for (const i of ids) {
        if (on) next.add(i);
        else next.delete(i);
      }
      return next;
    });
    setAnchor(id);
  };
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of rows) {
        if (pageAll) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });

  // ---- views and export ----
  const { views, save, remove } = useSavedViews();
  const currentQuery = viewQuery(params);
  const allTags = useMemo(() => Array.from(new Set(devices.flatMap((d) => d.tags))).sort(), [devices]);
  const exportCsv = (list: Device[]) => downloadCsv(toCsv(list, ctx), csvFileName());

  const asCards = useMediaQuery(CARDS_QUERY);

  // A click anywhere on a row opens the device, as a convenience for the
  // mouse; the hostname link is the real control and what the keyboard
  // uses. Delegated on the table, so it needs neither a handler per row nor
  // `position: relative` on <tr>, which older Safari ignores.
  const navigate = useNavigate();
  const rowClicks = useCallback(
    (table: HTMLTableElement | null) => {
      if (!table) return;
      const onClick = (e: globalThis.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button, input, label, select')) return;
        // Selecting a hostname to copy it is not a request to leave.
        if (window.getSelection()?.toString()) return;
        const href = target.closest<HTMLElement>('tr[data-href]')?.dataset.href;
        if (!href) return;
        if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener');
        else navigate(href);
      };
      table.addEventListener('click', onClick);
      return () => table.removeEventListener('click', onClick);
    },
    [navigate],
  );
  const narrowed = filter !== 'alle' || q.trim() !== '' || personFilter !== null;
  const resetFilters = () => {
    setQ('');
    setParam({ filter: null, q: null, person: null });
  };

  return (
    <div className={canOperate && selectedDevices.length > 0 ? 'screen dl has-bulk' : 'screen dl'}>
      <PageHeader
        title="Geräte"
        count={devices.length}
        actions={
          devices.length > 0 && (
            <button type="button" className="btn" onClick={() => exportCsv(shown)} disabled={shown.length === 0}>
              <IconDownload size={14} /> CSV exportieren
            </button>
          )
        }
      />

      {devices.length === 0 && loadError ? (
        <ErrorNote error={loadError} onRetry={onRetry} />
      ) : devices.length === 0 && !loading ? (
        <EmptyState
          icon={<IconMonitor size={22} />}
          title="Noch keine Geräte"
          actions={
            onOpenEnroll && (
              <button type="button" className="btn btn-primary" onClick={onOpenEnroll}>
                <IconPlus size={14} /> Gerät hinzufügen
              </button>
            )
          }
        >
          Ein Gerät kommt mit einem Einmal-Token in die Liste: Agent installieren, Token eingeben, fertig.
        </EmptyState>
      ) : (
        <>
          <div className="dl-toolbar">
            <div className="dl-search">
              <IconSearch size={15} />
              <input
                type="search"
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setParam({ q: e.target.value });
                }}
                placeholder="Hostname, Person, Tag …"
                aria-label="Geräte durchsuchen"
              />
            </div>
            {persons.length > 0 && (
              <select
                className={personFilter === null ? 'input dl-person' : 'input dl-person is-set'}
                value={personFilter ?? ''}
                onChange={(e) => setParam({ person: e.target.value || null })}
                aria-label="Nach Person filtern"
              >
                <option value="">Alle Personen</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <ViewsPopover
              views={views}
              current={currentQuery}
              onApply={(v) => {
                const next = new URLSearchParams(v.query);
                setQ(next.get('q') ?? '');
                setParams(next, { replace: true });
              }}
              onSave={(name) => save(name, currentQuery)}
              onRemove={remove}
            />
          </div>
          <div className="dl-filters">
            <FilterBar
              options={filterOptions}
              value={filter}
              onChange={(f) => setParam({ filter: f === 'alle' ? null : f })}
              label="Geräte filtern"
            />
          </div>

          {canOperate && selectedDevices.length > 0 && (
            <BulkBar
              selected={selectedDevices}
              fleet={devices}
              hidden={hiddenSelected}
              allTags={allTags}
              onClear={() => setSelected(new Set())}
              onExport={() => exportCsv(selectedDevices)}
            />
          )}
          {canOperate && pageAll && shown.length > rows.length && selectedDevices.length < shown.length && (
            <p className="dl-selectall">
              Alle {fmt.format(rows.length)} Geräte dieser Seite sind ausgewählt.{' '}
              <button type="button" className="link-btn" onClick={() => setSelected(new Set(shown.map((d) => d.id)))}>
                Alle {fmt.format(shown.length)} Treffer auswählen
              </button>
            </p>
          )}

          <section className="dl-list" aria-label="Geräteliste">
            {loading && devices.length === 0 ? (
              <SkeletonRows rows={6} />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<IconSearch size={22} />}
                title="Keine Geräte gefunden"
                actions={
                  narrowed && (
                    <button type="button" className="btn" onClick={resetFilters}>
                      Filter zurücksetzen
                    </button>
                  )
                }
              >
                {narrowed ? 'Kein Gerät passt zu Filter, Person und Suche zusammen.' : null}
              </EmptyState>
            ) : asCards ? (
              <ul className="dcards">
                {rows.map((d) => (
                  <li key={d.id} className={selected.has(d.id) ? 'dcard is-selected' : 'dcard'}>
                    {canOperate && (
                      <input
                        type="checkbox"
                        className="dl-check"
                        checked={selected.has(d.id)}
                        onChange={(e) => toggle(d.id, e)}
                        aria-label={`${d.hostname} auswählen`}
                      />
                    )}
                    <div className="dcard-main">
                      <div className="dcard-top">
                        <OsIcon os={d.os} size={14} />
                        <Link to={`/devices/${d.id}`} className="dl-link">
                          {d.hostname}
                        </Link>
                        <StatusCell d={d} />
                      </div>
                      <Subline d={d} />
                      {isAgent(d) ? (
                        <dl className="dcard-facts">
                          <div>
                            <dt>CPU</dt>
                            <dd>
                              <Load pct={livePct(d, 'cpu_pct')} kind="cpu" />
                            </dd>
                          </div>
                          <div>
                            <dt>RAM</dt>
                            <dd>
                              <Load pct={livePct(d, 'mem_pct')} kind="ram" />
                            </dd>
                          </div>
                          <div>
                            <dt>Disk</dt>
                            <dd>
                              <Load pct={diskPct(d)} kind="disk" />
                            </dd>
                          </div>
                          <div>
                            <dt>Updates</dt>
                            <dd>
                              <Updates d={d} summary={patchSummary} />
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                      <div className="dcard-foot">
                        <span>{ownerOf(d, ctx) || 'Ohne Person'}</span>
                        <Seen d={d} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dt-wrap">
                <table className="dt" ref={rowClicks}>
                  <thead>
                    <tr>
                      {canOperate && (
                        <th scope="col" className="c-check">
                          <input
                            type="checkbox"
                            className="dl-check"
                            checked={pageAll}
                            ref={(el) => {
                              if (el) el.indeterminate = pageSome && !pageAll;
                            }}
                            onChange={togglePage}
                            aria-label="Alle Geräte dieser Seite auswählen"
                          />
                        </th>
                      )}
                      {COLUMNS.map((c) => (
                        <SortHeader key={c.key} col={c} sort={sort} onSort={(k) => setParam({ sort: formatSort(nextSort(sort, k)) })} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id} data-href={`/devices/${d.id}`} className={selected.has(d.id) ? 'is-selected' : undefined}>
                        {canOperate && (
                          <td className="c-check">
                            <input
                              type="checkbox"
                              className="dl-check"
                              checked={selected.has(d.id)}
                              onChange={(e) => toggle(d.id, e)}
                              aria-label={`${d.hostname} auswählen`}
                            />
                          </td>
                        )}
                        <td className="c-name">
                          <span className="dl-name">
                            <OsIcon os={d.os} size={14} />
                            <Link to={`/devices/${d.id}`} className="dl-link" title={d.hostname}>
                              {d.hostname}
                            </Link>
                          </span>
                          <Subline d={d} />
                        </td>
                        <td className="c-status">
                          <StatusCell d={d} />
                        </td>
                        <td className="c-person">{ownerOf(d, ctx) || <span className="dl-none">—</span>}</td>
                        {/* Ohne Agent gibt es keine Messwerte: ein Strich statt eines
                            leeren Balkens, der wie „0 %" aussähe. Warum, sagt der Status. */}
                        <td className="c-load c-cpu">
                          <Load pct={livePct(d, 'cpu_pct')} kind="cpu" />
                        </td>
                        <td className="c-load c-ram">
                          <Load pct={livePct(d, 'mem_pct')} kind="ram" />
                        </td>
                        <td className="c-load c-disk">
                          <Load pct={diskPct(d)} kind="disk" />
                        </td>
                        <td className="c-upd">
                          <Updates d={d} summary={patchSummary} />
                        </td>
                        <td className="c-agent">
                          <AgentVersion d={d} />
                        </td>
                        <td className="c-seen">
                          <Seen d={d} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pager.items.length > rows.length && (
              <p className="dl-cap">
                Angezeigt werden die ersten {fmt.format(RENDER_CAP)} von {fmt.format(pager.items.length)} Geräten. Ein Filter
                oder eine kleinere Seitengröße zeigt den Rest.
              </p>
            )}
            <Pagination {...pager} label="Geräte" />
          </section>

          {devices.length > 0 && <SoftwareSearch />}
        </>
      )}
    </div>
  );
}
