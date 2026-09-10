import { useEffect, useMemo, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { AUDIT_CATEGORY, auditDayLabel, describeAudit } from '../auditText';
import { useServerPagination } from '../hooks/usePagination';
import type { AuditEvent } from '../types';
import { FilterBar, type FilterOption } from './FilterBar';
import { Pagination } from './Pagination';

const REFRESH_MS = 30_000;

type Range = '24h' | '7d' | '30d' | 'alle';

const RANGE_SECONDS: Record<Range, number | null> = {
  '24h': 86_400,
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
  alle: null,
};

const RANGE_OPTIONS: FilterOption<Range>[] = [
  { id: '24h', label: '24 Stunden' },
  { id: '7d', label: '7 Tage' },
  { id: '30d', label: '30 Tage' },
  { id: 'alle', label: 'Alles' },
];

const CATEGORY_IDS = Object.keys(AUDIT_CATEGORY);

function timeOfDay(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The raw `detail` blob, one key per line. The interesting fields differ per
 *  event type, so there is nothing to lay out in advance — but hiding them
 *  entirely was worse: "Befehl auf Gerät 4" without the command is not an
 *  audit trail. */
function DetailTable({ e }: { e: AuditEvent }) {
  const entries = Object.entries(e.detail);
  return (
    <div className="audit-detail">
      <dl className="kv">
        <dt>Ereignis</dt>
        <dd className="mono">{e.event}</dd>
        <dt>Zeitpunkt</dt>
        <dd>{new Date(e.ts * 1000).toLocaleString('de-DE')}</dd>
        <dt>Akteur</dt>
        <dd>{e.actor || 'system'}</dd>
        {e.device_id !== null && (
          <>
            <dt>Gerät</dt>
            <dd className="mono">#{e.device_id}</dd>
          </>
        )}
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="mono">{k}</dt>
            <dd className="mono audit-detail-val">
              {typeof v === 'string' ? v : JSON.stringify(v)}
            </dd>
          </div>
        ))}
      </dl>
      {entries.length === 0 && (
        <span className="muted" style={{ fontSize: 11 }}>
          Dieses Ereignis trägt keine weiteren Felder.
        </span>
      )}
    </div>
  );
}

/**
 * The audit log as something you can actually investigate with.
 *
 * It used to be a flat dump of the last 200 rows with no filters, no search
 * and no way to see what an event carried — which made it a place to confirm
 * that logging happens, not a place to answer "who revealed that password
 * last week". Filtering and paging both happen in SQL, so the page stays the
 * same size whether the log holds a thousand rows or a million.
 */
export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [actors, setActors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [range, setRange] = useState<Range>('7d');
  const [securityOnly, setSecurityOnly] = useState(false);
  const [category, setCategory] = useState('');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  // Debounced, so typing does not fire a query per keystroke.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filterKey = `${range}|${securityOnly}|${category}|${actor}|${search}`;
  const pager = useServerPagination(total, 'audit', filterKey);
  const { limit, offset } = pager;

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () => {
      const seconds = RANGE_SECONDS[range];
      return api
        .audit(
          {
            limit,
            offset,
            since: seconds === null ? undefined : Math.floor(Date.now() / 1000) - seconds,
            securityOnly,
            category: category || undefined,
            actor: actor || undefined,
            q: search || undefined,
          },
          ctrl.signal,
        )
        .then((r) => {
          setEvents(r.events);
          setTotal(r.total);
          setError(null);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(apiErrorMessage(e));
        });
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [limit, offset, range, securityOnly, category, actor, search]);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .auditMeta(ctrl.signal)
      .then((r) => setActors(r.actors))
      .catch(() => setActors([]));
    return () => ctrl.abort();
  }, []);

  const filtered = securityOnly || category !== '' || actor !== '' || search !== '' || range !== '7d';
  const reset = () => {
    setRange('7d');
    setSecurityOnly(false);
    setCategory('');
    setActor('');
    setQ('');
  };

  // Rows carry their own day header, so a page that spans midnight reads as
  // two days instead of one undifferentiated run of timestamps.
  const rows = useMemo(() => {
    const out: { day: string; events: AuditEvent[] }[] = [];
    for (const e of events ?? []) {
      const day = auditDayLabel(e.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.events.push(e);
      else out.push({ day, events: [e] });
    }
    return out;
  }, [events]);

  return (
    <div className="screen">
      <div className="page-head center">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 className="page-title">Audit-Log</h1>
          <span className="muted" style={{ fontSize: 11.5 }}>
            append-only · jede Aktion mit Akteur, Gerät und Zeitstempel
          </span>
        </div>
        <input
          className="input grow"
          style={{ marginLeft: 'auto', width: 230, flex: 'none' }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suchen: Ereignis, Akteur, Detail…"
          aria-label="Audit-Log durchsuchen"
        />
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <FilterBar options={RANGE_OPTIONS} value={range} onChange={setRange} label="Zeitraum" />
        <button
          type="button"
          className={securityOnly ? 'btn btn-danger' : 'btn'}
          aria-pressed={securityOnly}
          onClick={() => setSecurityOnly((v) => !v)}
          title="Anmeldungen, Konten, aufgedeckte Passwörter, Enrollment-Token, Fernzugriff, gelöschte Geräte"
        >
          Nur Sicherheit
        </button>
        <select
          className={category ? 'input btn-sm accent-border' : 'input btn-sm'}
          style={{ padding: '7px 10px' }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={securityOnly}
          aria-label="Nach Kategorie filtern"
        >
          <option value="">Alle Kategorien</option>
          {CATEGORY_IDS.map((c) => (
            <option key={c} value={c}>
              {AUDIT_CATEGORY[c]?.label ?? c}
            </option>
          ))}
        </select>
        <select
          className={actor ? 'input btn-sm accent-border' : 'input btn-sm'}
          style={{ padding: '7px 10px' }}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label="Nach Akteur filtern"
        >
          <option value="">Alle Akteure</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {filtered && (
          <button className="btn btn-sm" onClick={reset}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      {error && <p className="err">{error}</p>}

      {events === null ? (
        <div className="card" style={{ padding: 16 }} />
      ) : events.length === 0 ? (
        <div className="empty">
          <h2>Keine Ereignisse</h2>
          <p className="muted">
            {filtered
              ? 'Für diese Filter gibt es nichts. Zeitraum erweitern oder Filter zurücksetzen.'
              : 'Sobald etwas passiert, steht es hier.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {rows.map((group) => (
            <div key={group.day}>
              <div className="audit-day">{group.day}</div>
              {group.events.map((e) => {
                const meta = AUDIT_CATEGORY[e.category] ?? AUDIT_CATEGORY.other;
                const open = expanded === e.id;
                return (
                  <div key={e.id}>
                    <button
                      className={open ? 'audit-row open' : 'audit-row'}
                      onClick={() => setExpanded(open ? null : e.id)}
                      aria-expanded={open}
                    >
                      <span className="audit-arrow">{open ? '▾' : '▸'}</span>
                      <span className="audit-time mono">{timeOfDay(e.ts)}</span>
                      <span className={`badge ${meta?.tone ?? 'badge-off'} audit-cat`}>
                        {meta?.label ?? e.category}
                      </span>
                      <span className="audit-actor">{e.actor || 'system'}</span>
                      <span className="audit-text">{describeAudit(e)}</span>
                      {e.security && (
                        <span className="audit-shield" title="Sicherheitsrelevant">
                          🛡
                        </span>
                      )}
                    </button>
                    {open && <DetailTable e={e} />}
                  </div>
                );
              })}
            </div>
          ))}
          <Pagination {...pager} label="Ereignisse" />
        </div>
      )}
    </div>
  );
}
