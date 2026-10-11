import './audit.css';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { auditCategoryLabel, auditNamesFrom, describeAudit, type AuditNames } from '../../auditText';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { Pagination } from '../../components/Pagination';
import { formatDateTime } from '../../format';
import { useServerPagination } from '../../hooks/usePagination';
import {
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconHistory,
  IconMonitor,
  IconSearch,
  IconShield,
} from '../../icons';
import { devicePath } from '../../routes';
import type { AuditEvent, Device } from '../../types';
import { EmptyState, ErrorNote, KeyValue, PageHeader, Panel, SkeletonRows, Switch } from '../../ui';
import { downloadCsv } from '../devices/deviceList';
import {
  CATEGORY_IDS,
  DEFAULT_RANGE,
  RANGE_LABEL,
  RANGE_SPAN,
  RANGES,
  actorLabel,
  csvFileName,
  detailRows,
  deviceName,
  groupByDay,
  hasFilters,
  isNarrowed,
  readFilters,
  sinceFor,
  timeOfDay,
  toCsv,
  type Range,
} from './auditLog';

interface Props {
  /** Live fleet: rows written before the server stored hostnames still name
   *  their device, and a device that still exists gets a link. */
  devices: Device[];
}

const REFRESH_MS = 30_000;
/** Typing pauses this long before the search goes to the server. */
const SEARCH_DELAY_MS = 300;

const fmt = new Intl.NumberFormat('de-DE');
const nowSeconds = () => Math.floor(Date.now() / 1000);

const RANGE_OPTIONS: FilterOption<Range>[] = RANGES.map((id) => ({ id, label: RANGE_LABEL[id] }));

function Entry({
  e,
  names,
  linkable,
  open,
  onToggle,
}: {
  e: AuditEvent;
  names: AuditNames;
  /** The device still exists, so its page can be opened. */
  linkable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = useId();
  const device = deviceName(e, names);
  const fields = detailRows(e);
  const category = auditCategoryLabel(e.category);

  const rows: [ReactNode, ReactNode][] = [
    ['Ereignis', <code>{e.event}</code>],
    ['Zeitpunkt', formatDateTime(e.ts)],
    ['Akteur', actorLabel(e)],
  ];
  if (e.device_id !== null)
    rows.push([
      'Gerät',
      <>
        {device} <span className="aud-id">ID {e.device_id}</span>
      </>,
    ]);
  rows.push(['Kategorie', e.security ? `${category} · sicherheitsrelevant` : category]);
  for (const f of fields)
    rows.push([
      f.label ?? <code>{f.key}</code>,
      f.code ? <code className="aud-code">{f.value}</code> : <span className="aud-val">{f.value}</span>,
    ]);

  return (
    <li className={open ? 'aud-item is-open' : 'aud-item'}>
      <button
        type="button"
        className="aud-toggle"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <span className="aud-chev" aria-hidden>
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
        <time className="aud-time" dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>
          {timeOfDay(e.ts)}
        </time>
        <span className="aud-text">{describeAudit(e, names)}</span>
      </button>
      <div className="aud-meta">
        <span className="aud-actor">{actorLabel(e)}</span>
        {device !== null &&
          e.device_id !== null &&
          (linkable ? (
            <Link to={devicePath(e.device_id)} className="aud-dev">
              <IconMonitor size={13} />
              {device}
            </Link>
          ) : (
            <span className="aud-dev">
              <IconMonitor size={13} />
              {device}
            </span>
          ))}
        <span className="chip">{category}</span>
        {e.security && (
          <span className="aud-flag">
            <IconShield size={12} />
            Sicherheit
          </span>
        )}
      </div>
      {open && (
        <div id={detailId} className="aud-detail">
          <KeyValue rows={rows} />
          {fields.length === 0 && <p className="aud-none">Dieses Ereignis trägt keine weiteren Felder.</p>}
        </div>
      )}
    </li>
  );
}

/**
 * The audit log as something to investigate with: who did what, on which
 * device, when — filtered by person, kind of event, time range and free text,
 * each entry opening to every field it carries. Filtering and paging happen
 * in SQL, so the page stays the same size whether the log holds a thousand
 * rows or a million. The filters live in the address, so "every login of
 * last week" can be bookmarked and passed on.
 */
export function AuditPage({ devices }: Props) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);

  // The search text is component state and only written to the URL: React
  // Router applies URL changes in a transition, so an input controlled by
  // the URL drops keystrokes when someone types fast.
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [search, setSearch] = useState(() => q.trim());
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [q]);
  const searchId = useId();
  const csvHintId = useId();

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

  // The total arrives with each page, but the page is cut by the pager —
  // so the pager works from the last total the server reported.
  const [total, setTotal] = useState(0);
  const filterKey = `${filters.range}|${filters.security}|${filters.category}|${filters.actor}|${search}`;
  const pager = useServerPagination(total, 'audit', filterKey);
  const { limit, offset } = pager;

  const log = useQuery({
    queryKey: ['audit', 'log', filters.range, filters.security, filters.category, filters.actor, search, limit, offset],
    queryFn: ({ signal }) =>
      api.audit(
        {
          limit,
          offset,
          // Taken when the request goes out, not when the filter was set: a
          // page left open overnight still means "the last 24 hours".
          since: sinceFor(filters.range, nowSeconds()),
          securityOnly: filters.security,
          category: filters.category || undefined,
          actor: filters.actor || undefined,
          q: search || undefined,
        },
        signal,
      ),
    // The previous page stays on screen while the next one loads, instead of
    // the list collapsing into a skeleton on every filter click.
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const reported = log.data?.total;
  if (reported !== undefined && reported !== total) setTotal(reported);

  const meta = useQuery({ queryKey: ['audit', 'meta'], queryFn: ({ signal }) => api.auditMeta(signal) });
  // Only for naming old rows that stored a script id: if the list does not
  // load, the id stands there and the log stays usable.
  const scripts = useQuery({
    queryKey: qk.scripts,
    queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts),
  });

  const names = useMemo(() => auditNamesFrom(devices, scripts.data), [devices, scripts.data]);
  const fleetIds = useMemo(() => new Set(devices.map((d) => d.id)), [devices]);
  const events = useMemo(() => log.data?.events ?? [], [log.data]);
  const groups = useMemo(() => groupByDay(events), [events]);

  // A filter the URL names stays selectable even before (or without) the
  // list of actors, so a shared link shows what it filters by.
  const actors = useMemo(() => {
    const list = meta.data?.actors ?? [];
    return filters.actor && !list.includes(filters.actor) ? [filters.actor, ...list] : list;
  }, [meta.data, filters.actor]);

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const narrowed = isNarrowed(filters, search);
  const filtered = hasFilters(filters, search);
  const reset = () => {
    setQ('');
    setSearch('');
    setParam({ range: null, security: null, category: null, actor: null, q: null });
  };

  // The page has its own route guard; a 403 here means the role changed
  // under an open tab. Said plainly instead of as a raw server message.
  const denied = log.error instanceof ApiError && log.error.status === 403;
  const exportCsv = () => downloadCsv(toCsv(events, names), csvFileName(pager.page));

  let body: ReactNode;
  if (log.error && !log.data) {
    body = (
      <div className="aud-pad">
        <ErrorNote error={log.error} onRetry={() => void log.refetch()} />
      </div>
    );
  } else if (log.isPending) {
    body = (
      <div className="aud-pad">
        <SkeletonRows rows={8} />
      </div>
    );
  } else if (events.length === 0) {
    body = filtered ? (
      <EmptyState
        icon={<IconSearch size={22} />}
        title="Keine Einträge für diesen Filter"
        actions={
          <button type="button" className="btn" onClick={reset}>
            Filter zurücksetzen
          </button>
        }
      >
        Suche, Akteur oder Kategorie schließen alles aus. Ein längerer Zeitraum oder weniger Filter zeigen mehr.
      </EmptyState>
    ) : filters.range !== 'alle' ? (
      <EmptyState
        icon={<IconHistory size={22} />}
        title={`Keine Einträge in ${RANGE_SPAN[filters.range]}`}
        actions={
          <button type="button" className="btn" onClick={() => setParam({ range: 'alle' })}>
            Alles anzeigen
          </button>
        }
      >
        Ältere Einträge zeigt der Zeitraum „Alles“.
      </EmptyState>
    ) : (
      <EmptyState icon={<IconHistory size={22} />} title="Noch keine Einträge">
        Anmeldungen, Aufträge und Änderungen an Geräten erscheinen hier, sobald sie passieren.
      </EmptyState>
    );
  } else {
    body = (
      <>
        {log.error && (
          <div className="aud-pad">
            <ErrorNote error={log.error} onRetry={() => void log.refetch()} />
          </div>
        )}
        <div className={log.isPlaceholderData ? 'aud-days is-stale' : 'aud-days'} aria-busy={log.isPlaceholderData}>
          {groups.map((g) => (
            <section key={g.day} className="aud-day" aria-label={g.day}>
              <h3 className="aud-day-label">{g.day}</h3>
              <ol className="aud-items">
                {g.events.map((e) => (
                  <Entry
                    key={e.id}
                    e={e}
                    names={names}
                    linkable={e.device_id !== null && fleetIds.has(e.device_id)}
                    open={expanded.has(e.id)}
                    onToggle={() => toggle(e.id)}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
        <Pagination {...pager} label="Ereignisse" />
      </>
    );
  }

  return (
    <div className="screen aud">
      <PageHeader
        title="Audit-Log"
        subtitle="Jede Aktion mit Akteur, Gerät und Zeitpunkt. Einträge werden nur angefügt, nie geändert."
        actions={
          !denied && (
            <>
              <button
                type="button"
                className="btn"
                onClick={exportCsv}
                disabled={events.length === 0 || log.isPlaceholderData}
                aria-describedby={csvHintId}
              >
                <IconDownload size={14} /> CSV exportieren
              </button>
              <span id={csvHintId} className="sr-only">
                {`Exportiert die ${fmt.format(events.length)} Einträge dieser Seite`}
              </span>
            </>
          )
        }
      />

      {denied ? (
        <EmptyState icon={<IconShield size={22} />} title="Kein Zugriff">
          Das Audit-Log ist nur für Administratoren freigegeben.
        </EmptyState>
      ) : (
        <>
          <div className="aud-toolbar">
            <div className="aud-search">
              <IconSearch size={15} />
              <label htmlFor={searchId} className="sr-only">
                Audit-Log durchsuchen
              </label>
              <input
                id={searchId}
                type="search"
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setParam({ q: e.target.value.trim() || null });
                }}
                placeholder="Ereignis, Akteur, Hostname, Befehl …"
              />
            </div>
            <select
              className={filters.actor ? 'input aud-select is-set' : 'input aud-select'}
              value={filters.actor}
              onChange={(e) => setParam({ actor: e.target.value || null })}
              aria-label="Nach Akteur filtern"
            >
              <option value="">Alle Akteure</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className={filters.category ? 'input aud-select is-set' : 'input aud-select'}
              value={filters.category}
              onChange={(e) => setParam({ category: e.target.value || null })}
              disabled={filters.security}
              aria-label="Nach Kategorie filtern"
            >
              <option value="">Alle Kategorien</option>
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {auditCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="aud-filters">
            <FilterBar
              options={RANGE_OPTIONS}
              value={filters.range}
              onChange={(r) => setParam({ range: r === DEFAULT_RANGE ? null : r })}
              label="Zeitraum"
            />
            {/* The switch carries its own name; the visible word repeats it
                for the eye and stays out of the accessibility tree. */}
            <div className="aud-switch">
              <Switch
                checked={filters.security}
                onChange={(on) => setParam(on ? { security: '1', category: null } : { security: null })}
                label="Nur Sicherheit"
              />
              <span aria-hidden>Nur Sicherheit</span>
            </div>
            {narrowed && (
              <button type="button" className="link-btn aud-reset" onClick={reset}>
                Filter zurücksetzen
              </button>
            )}
          </div>
          {filters.security && (
            <p className="aud-note">
              Sicherheitsrelevant sind Anmeldungen, Konten, Passwörter, Enrollment-Token, Fernzugriffe und gelöschte
              Geräte. Die Kategorie gilt dabei nicht.
            </p>
          )}

          <Panel
            title="Ereignisse"
            meta={
              log.data && (
                <span role="status">
                  {fmt.format(log.data.total)} {log.data.total === 1 ? 'Eintrag' : 'Einträge'}
                </span>
              )
            }
            padded={false}
          >
            {body}
          </Panel>
        </>
      )}
    </div>
  );
}
