import { useEffect, useMemo, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import { osShort } from '../deviceStatus';
import { OsIcon } from '../icons';
import type { Device, InventoryMatch, PatchSummary, Person } from '../types';
import { Dot, Skeleton } from '../ui';
import { deviceState, diskColor, stateColor } from '../deviceStatus';

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

type Filter = 'alle' | 'server' | 'familie' | 'probleme' | 'offline';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'server', label: 'Server' },
  { id: 'familie', label: 'Familie' },
  { id: 'probleme', label: 'Probleme' },
  { id: 'offline', label: 'Offline' },
];

const COLS = '16fr 8fr 10fr 8fr 8fr 8fr 6fr 6fr 8fr';

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="bar" style={{ flex: 1 }}>
      <span className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function DevicesPage({ devices, patchSummary, persons, loading, onOpenDevice }: Props) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');
  const [personFilter, setPersonFilter] = useState<number | 'alle'>('alle');

  const personName = (id: number | null) =>
    id === null ? '' : (persons.find((p) => p.id === id)?.name ?? '');

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return devices.filter((d) => {
      if (query) {
        const hay = `${d.hostname} ${d.owner_label} ${personName(d.person_id)} ${d.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      if (personFilter !== 'alle' && d.person_id !== personFilter) return false;
      const st = deviceState(d);
      switch (filter) {
        case 'server':
          return d.tags.includes('server');
        case 'familie':
          return d.tags.includes('familie') || d.tags.includes('familie'.toLowerCase());
        case 'probleme':
          return st !== 'ok';
        case 'offline':
          return !d.online;
        default:
          return true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, persons, q, filter, personFilter]);

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

      <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'btn btn-accent btn-sm' : 'btn btn-sm'}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        {persons.length > 0 && (
          <select
            className={personFilter === 'alle' ? 'input btn-sm' : 'input btn-sm accent-border'}
            style={{ padding: '5px 9px', marginLeft: 4 }}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value === 'alle' ? 'alle' : Number(e.target.value))}
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
          <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 820 }}>
            <span>Gerät</span>
            <span>Besitzer</span>
            <span>Tags</span>
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
            shown.map((d) => {
              const st = deviceState(d);
              const disk = Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
              const cpu = d.online ? Math.round(d.heartbeat.cpu_pct ?? 0) : 0;
              const ram = d.online ? Math.round(d.heartbeat.mem_pct ?? 0) : 0;
              const patches = patchSummary[String(d.id)];
              return (
                <button
                  key={d.id}
                  className="tbl-row"
                  style={{ gridTemplateColumns: COLS, minWidth: 820 }}
                  onClick={() => onOpenDevice(d.id)}
                >
                  <span className="cell-name">
                    <Dot color={stateColor(st)} />
                    <span className="name">{d.hostname}</span>
                    <span className="chip-mono" title={osShort(d.os)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <OsIcon os={d.os} size={11} /> {osShort(d.os)}
                    </span>
                  </span>
                  <span style={{ color: 'var(--tx2)', fontWeight: 600 }}>
                    {personName(d.person_id) || d.owner_label || '—'}
                  </span>
                  <span style={{ display: 'flex', gap: 4, overflow: 'hidden' }}>
                    {d.tags.slice(0, 2).map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="cell-bar">
                    <Bar pct={cpu} color="var(--accent)" />
                    <span className="pct">{d.online ? `${cpu}%` : '—'}</span>
                  </span>
                  <span className="cell-bar">
                    <Bar pct={ram} color="var(--violet)" />
                    <span className="pct">{d.online ? `${ram}%` : '—'}</span>
                  </span>
                  <span className="cell-bar">
                    <Bar pct={Math.round(disk)} color={diskColor(disk)} />
                    <span className="pct" style={{ color: diskColor(disk) }}>
                      {disk ? `${Math.round(disk)}%` : '—'}
                    </span>
                  </span>
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
      </div>

      {devices.length > 0 && <SoftwareSearch onOpenDevice={onOpenDevice} />}
    </div>
  );
}
