import { useMemo, useState } from 'react';
import { formatRelative } from '../format';
import { osShort } from '../ui';
import type { Device, PatchSummary, Person } from '../types';
import { Dot, Skeleton, deviceState, diskColor, stateColor } from '../ui';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  loading: boolean;
  onOpenDevice: (id: number) => void;
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
          placeholder="⌕ Hostname, Besitzer, Tag…"
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
            <option value="alle">◉ Alle Personen</option>
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
                    <span className="chip-mono">{osShort(d.os)}</span>
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
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--tx2)' }}>
                    {d.agent_version || '—'}
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
    </div>
  );
}
