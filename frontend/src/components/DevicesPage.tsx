import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative, osLabel } from '../format';
import { osShort } from '../deviceStatus';
import { OsIcon } from '../icons';
import type { Device, InventoryMatch, PatchSummary, Person } from '../types';
import { Dot, Skeleton } from '../ui';
import { FilterBar, type FilterOption } from './FilterBar';
import { Pagination } from './Pagination';
import { usePagination } from '../hooks/usePagination';
import { deviceState, hasProblem, loadColor, stateColor, type LoadKind } from '../deviceStatus';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  loading: boolean;
  onOpenDevice: (id: number) => void;
}

/** Fleet-wide software search: 'auf welchen Geräten ist Java?'. Debounced,
 * hits /api/inventory/search. */
function SoftwareSearch({ onOpenDevice }: { onOpenDevice: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<InventoryMatch[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const query = q.trim();
    // Clearing happens in onChange below — an effect that resets state
    // synchronously just causes an extra render pass.
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .searchInventory(query, ctrl.signal)
        .then((r) => setResults(r.results))
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(apiErrorMessage(e));
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="card-title-sm">Software-Suche über alle Geräte</span>
        <input
          className="input btn-sm grow"
          style={{ marginLeft: 'auto', width: 260, flex: 'none' }}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) {
              setResults(null);
              setError('');
            }
          }}
          placeholder="Paketname, z. B. java, openssl, firefox…"
          aria-label="Software über alle Geräte suchen"
        />
      </div>
      {error && <p className="err">{error}</p>}
      {results !== null && (
        results.length === 0 ? (
          <span className="muted" style={{ fontSize: 11.5 }}>Keine Treffer in den Inventaren.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 240, overflowY: 'auto' }}>
            {results.map((r, i) => (
              <button
                key={`${r.device_id}-${r.name}-${i}`}
                className="row"
                style={{ gap: 10, padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx)', textAlign: 'left', fontSize: 12 }}
                onClick={() => onOpenDevice(r.device_id)}
              >
                <span style={{ fontWeight: 700, minWidth: 130 }}>{r.hostname}</span>
                <span style={{ flex: 1 }}>{r.name}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{r.version}</span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

type Filter = 'alle' | 'ok' | 'probleme' | 'server' | 'familie' | 'offline';

const FILTERS: Filter[] = ['alle', 'ok', 'probleme', 'server', 'familie', 'offline'];

const FILTER_LABEL: Record<Filter, string> = {
  alle: 'Alle',
  ok: 'In Ordnung',
  probleme: 'Probleme',
  server: 'Server',
  familie: 'Familie',
  offline: 'Offline',
};

/** Does a device belong in this filter? One predicate per filter, so the
 *  counts on the chips and the rows below can never drift apart. */
function matchesFilter(d: Device, f: Filter): boolean {
  switch (f) {
    case 'ok':
      // Erreichbar und ohne Befund — das Gegenstück zu 'probleme', damit der
      // Zustandsbalken der Übersicht auf jede seiner Zeilen verlinken kann.
      return d.online && !hasProblem(d);
    case 'server':
      return d.tags.includes('server');
    case 'familie':
      return d.tags.includes('familie');
    case 'probleme':
      // Nur erreichbare Geräte mit einem echten Befund. Offline hat seinen
      // eigenen Filter — siehe hasProblem().
      return hasProblem(d);
    case 'offline':
      return !d.online;
    default:
      return true;
  }
}

const COLS = '23fr 10fr 13fr 13fr 13fr 5fr 8fr 9fr';

/** One labelled load bar: "CPU … 34 %" over a bar coloured by the value.
 *  Offline devices report no load at all, which is different from 0 % — they
 *  get a dash and an empty track. */
function Meter({ label, pct, kind, online }: { label: string; pct: number; kind: LoadKind; online: boolean }) {
  const color = loadColor(pct, kind);
  return (
    <span className="cell-meter">
      <span className="meter-line">
        <span className="meter-key">{label}</span>
        <span className="meter-val" style={{ color: online ? color : 'var(--tx3)' }}>
          {online ? `${pct}%` : '—'}
        </span>
      </span>
      <span className="bar">
        <span className="bar-fill" style={{ width: online ? `${pct}%` : '0%', background: color }} />
      </span>
    </span>
  );
}

export function DevicesPage({ devices, patchSummary, persons, loading, onOpenDevice }: Props) {
  const [q, setQ] = useState('');
  // Der Filter steht in der URL, nicht im State: so führt die Übersicht direkt
  // auf „Geräte mit Problem" und die Ansicht bleibt teil- und lesezeichenbar.
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter');
  const filter: Filter = FILTERS.includes(raw as Filter) ? (raw as Filter) : 'alle';
  const setFilter = (f: Filter) =>
    setParams(f === 'alle' ? {} : { filter: f }, { replace: true });
  const [personFilter, setPersonFilter] = useState<number | 'alle'>('alle');

  const personName = (id: number | null) =>
    id === null ? '' : (persons.find((p) => p.id === id)?.name ?? '');

  // Search and person narrow the set the filter chips count over, so their
  // numbers describe what clicking would actually show.
  const base = useMemo(() => {
    const query = q.trim().toLowerCase();
    const nameOf = (id: number | null) =>
      id === null ? '' : (persons.find((p) => p.id === id)?.name ?? '');
    return devices.filter((d) => {
      if (personFilter !== 'alle' && d.person_id !== personFilter) return false;
      if (!query) return true;
      const hay = `${d.hostname} ${d.owner_label} ${nameOf(d.person_id)} ${d.tags.join(' ')}`;
      return hay.toLowerCase().includes(query);
    });
  }, [devices, persons, q, personFilter]);

  const shown = useMemo(() => base.filter((d) => matchesFilter(d, filter)), [base, filter]);
  const pager = usePagination(shown, 'devices', `${filter}|${personFilter}|${q.trim()}`);

  const filterOptions: FilterOption<Filter>[] = (
    ['alle', 'ok', 'probleme', 'server', 'familie', 'offline'] as Filter[]
  ).map((id) => ({
    id,
    label: FILTER_LABEL[id],
    count: id === 'alle' ? undefined : base.filter((d) => matchesFilter(d, id)).length,
    tone: id === 'probleme' ? 'danger' : id === 'offline' ? 'warn' : id === 'ok' ? 'ok' : 'neutral',
  }));

  return (
    <div className="screen">
      <div className="page-head center">
        <h1 className="page-title">Geräte</h1>
        <span className="muted">{devices.length}</span>
        <input
          className="input grow"
          style={{ marginLeft: 'auto', width: 230, flex: 'none' }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suchen: Hostname, Besitzer, Tag…"
        />
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <FilterBar options={filterOptions} value={filter} onChange={setFilter} label="Geräte filtern" />
        {persons.length > 0 && (
          <select
            className={personFilter === 'alle' ? 'input btn-sm' : 'input btn-sm accent-border'}
            style={{ padding: '7px 10px' }}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value === 'alle' ? 'alle' : Number(e.target.value))}
            aria-label="Nach Person filtern"
          >
            <option value="alle">Alle Personen</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="tbl-scroll">
          <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 980 }}>
            <span>Gerät</span>
            <span>Besitzer</span>
            <span>CPU</span>
            <span>RAM</span>
            <span>Disk</span>
            <span>Patches</span>
            <span>Agent</span>
            <span style={{ textAlign: 'right' }}>Zuletzt</span>
          </div>
          {loading && devices.length === 0 ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton h={20} />
              <Skeleton h={20} />
              <Skeleton h={20} />
            </div>
          ) : shown.length === 0 ? (
            <div style={{ padding: '20px 18px' }} className="muted">
              Keine Geräte gefunden.
            </div>
          ) : (
            pager.items.map((d) => {
              const st = deviceState(d);
              const disk = Math.round(Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct)));
              const cpu = Math.round(d.heartbeat.cpu_pct ?? 0);
              const ram = Math.round(d.heartbeat.mem_pct ?? 0);
              const patches = patchSummary[String(d.id)];
              // Disk usage survives a reboot, so it stays meaningful while the
              // device is offline; CPU and RAM do not.
              const subtitle = [osLabel(d.os), ...d.tags].join(' · ');
              return (
                <button
                  key={d.id}
                  className="tbl-row device-row"
                  style={{ gridTemplateColumns: COLS, minWidth: 980 }}
                  onClick={() => onOpenDevice(d.id)}
                >
                  <span className="cell-device">
                    <Dot color={stateColor(st)} />
                    <span className="cell-device-text">
                      <span className="cell-device-top">
                        <span className="name">{d.hostname}</span>
                        <span className="chip-mono" title={osShort(d.os)}>
                          <OsIcon os={d.os} size={11} /> {osShort(d.os)}
                        </span>
                      </span>
                      <span className="cell-device-sub" title={subtitle}>
                        {subtitle}
                      </span>
                    </span>
                  </span>
                  <span style={{ color: 'var(--tx2)', fontWeight: 600 }}>
                    {personName(d.person_id) || d.owner_label || '—'}
                  </span>
                  <Meter label="CPU" pct={cpu} kind="cpu" online={d.online} />
                  <Meter label="RAM" pct={ram} kind="ram" online={d.online} />
                  <Meter label="Disk" pct={disk} kind="disk" online={disk > 0} />
                  <span>
                    {patches && patches.pending > 0 ? (
                      <span
                        className={patches.security > 0 ? 'badge badge-danger' : 'badge badge-warn'}
                        title={
                          patches.security > 0
                            ? `${patches.pending} ausstehend, davon ${patches.security} sicherheitsrelevant`
                            : `${patches.pending} ausstehend`
                        }
                      >
                        {patches.pending}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 11 }}>✓</span>
                    )}
                  </span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx2)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {d.agent_version || '—'}
                    {d.agent_update_available && (
                      <span
                        className="badge badge-warn"
                        style={{ fontSize: 9.5 }}
                        title={`Neue Agent-Version ${d.agent_update_available} verfügbar — Update im Gerät anstoßen`}
                      >
                        ⬆
                      </span>
                    )}
                  </span>
                  <span style={{ textAlign: 'right', fontWeight: 500, fontSize: 11, color: 'var(--tx3)' }}>
                    {formatRelative(d.last_seen_at)}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <Pagination {...pager} label="Geräte" />
      </div>

      {devices.length > 0 && <SoftwareSearch onOpenDevice={onOpenDevice} />}
    </div>
  );
}
