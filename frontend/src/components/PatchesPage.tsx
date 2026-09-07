import { useMemo, useState } from 'react';
import { osLabel } from '../format';
import type { Device, PatchSummary, Person } from '../types';
import { Dot } from '../ui';
import { deviceState, stateColor } from '../deviceStatus';
import type { ReactNode } from 'react';
import { AppleLogo, LinuxLogo, ServerRack, WindowsLogo } from '../icons';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  onOpenDevice: (id: number) => void;
}

const COLS = '16fr 8fr 8fr 8fr 8fr 10fr 10fr';

type OsCategory = 'win_pc' | 'win_server' | 'mac' | 'linux';

const CATEGORIES: { id: OsCategory; label: string; icon: ReactNode }[] = [
  { id: 'win_pc', label: 'Windows PC', icon: <WindowsLogo size={18} /> },
  { id: 'win_server', label: 'Windows Server', icon: <ServerRack size={18} /> },
  { id: 'mac', label: 'Mac', icon: <AppleLogo size={18} /> },
  { id: 'linux', label: 'Linux', icon: <LinuxLogo size={18} /> },
];

function categoryOf(d: Device): OsCategory {
  if (d.os === 'darwin') return 'mac';
  if (d.os === 'windows') return d.tags.includes('server') ? 'win_server' : 'win_pc';
  return 'linux';
}

/** Donut ring: patched share of a category, conic-gradient based. */
function Ring({ pct, label, icon, count }: { pct: number; label: string; icon: ReactNode; count: number }) {
  const empty = count === 0;
  const color = empty ? 'var(--line)' : pct >= 90 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--dangerS)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, minWidth: 108 }}>
      <div
        style={{
          width: 92,
          height: 92,
          borderRadius: '50%',
          background: empty
            ? 'var(--line)'
            : `conic-gradient(${color} ${pct * 3.6}deg, var(--line) ${pct * 3.6}deg)`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            background: 'var(--panel)',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, lineHeight: 1.2, color: 'var(--tx2)' }}>
            <span style={{ display: 'inline-flex' }}>{icon}</span>
            <span style={{ fontWeight: 800, fontSize: 12, color: empty ? 'var(--tx3)' : color }}>
              {empty ? '—' : `${pct}%`}
            </span>
          </div>
        </div>
      </div>
      <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--tx2)', textAlign: 'center' }}>{label}</span>
      <span className="muted" style={{ fontSize: 10 }}>
        {count} Gerät{count === 1 ? '' : 'e'}
      </span>
    </div>
  );
}

type Availability = 'alle' | 'online' | 'offline';
type PatchState = 'alle' | 'offen' | 'aktuell' | 'sicherheit';

export function PatchesPage({ devices, patchSummary, persons, onOpenDevice }: Props) {
  const [personFilter, setPersonFilter] = useState<number | 'alle'>('alle');
  const [osFilter, setOsFilter] = useState<OsCategory | 'alle'>('alle');
  const [availability, setAvailability] = useState<Availability>('alle');
  const [patchState, setPatchState] = useState<PatchState>('alle');

  const pending = (d: Device) => patchSummary[String(d.id)]?.pending ?? 0;
  const security = (d: Device) => patchSummary[String(d.id)]?.security ?? 0;

  const totalPending = Object.values(patchSummary).reduce((a, s) => a + s.pending, 0);
  const totalSecurity = Object.values(patchSummary).reduce((a, s) => a + s.security, 0);

  const rings = CATEGORIES.map((c) => {
    const inCat = devices.filter((d) => categoryOf(d) === c.id);
    const patched = inCat.filter((d) => pending(d) === 0).length;
    return {
      ...c,
      count: inCat.length,
      pct: inCat.length ? Math.round((patched / inCat.length) * 100) : 0,
    };
  });
  const patchedTotal = devices.filter((d) => pending(d) === 0).length;
  const overallPct = devices.length ? Math.round((patchedTotal / devices.length) * 100) : 0;

  const shown = useMemo(() => {
    return [...devices]
      .filter((d) => {
        if (personFilter !== 'alle' && d.person_id !== personFilter) return false;
        if (osFilter !== 'alle' && categoryOf(d) !== osFilter) return false;
        if (availability === 'online' && !d.online) return false;
        if (availability === 'offline' && d.online) return false;
        if (patchState === 'offen' && pending(d) === 0) return false;
        if (patchState === 'aktuell' && pending(d) > 0) return false;
        if (patchState === 'sicherheit' && security(d) === 0) return false;
        return true;
      })
      .sort((a, b) => pending(b) - pending(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, patchSummary, personFilter, osFilter, availability, patchState]);

  const personName = (id: number | null) =>
    id === null ? '' : (persons.find((p) => p.id === id)?.name ?? '');

  const chipCls = (active: boolean) => (active ? 'input btn-sm accent-border' : 'input btn-sm');

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Patch-Management</h1>
        <span className="muted">
          {totalPending} Updates offen · {totalSecurity} sicherheitskritisch
        </span>
      </div>

      {/* OS patch status */}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="card-title">OS-Patch-Status</span>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, fontSize: 26 }}>{overallPct}%</span>
          <span className="muted" style={{ fontSize: 11.5 }}>vollständig gepatcht</span>
          <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
            {patchedTotal} von {devices.length} Geräten
          </span>
        </div>
        <div className="bar" style={{ height: 7, borderRadius: 4 }}>
          <span
            className="bar-fill"
            style={{
              width: `${overallPct}%`,
              background: overallPct >= 90 ? 'var(--ok)' : overallPct >= 60 ? 'var(--warn)' : 'var(--dangerS)',
            }}
          />
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', justifyContent: 'space-around', paddingTop: 6 }}>
          {rings.map((r) => (
            <Ring key={r.id} pct={r.pct} label={r.label} icon={r.icon} count={r.count} />
          ))}
        </div>
      </div>

      {/* Filter row */}
      <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
        {persons.length > 0 && (
          <select
            className={chipCls(personFilter !== 'alle')}
            style={{ padding: '5px 9px' }}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value === 'alle' ? 'alle' : Number(e.target.value))}
          >
            <option value="alle">Personen · alle</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select
          className={chipCls(osFilter !== 'alle')}
          style={{ padding: '5px 9px' }}
          value={osFilter}
          onChange={(e) => setOsFilter(e.target.value as OsCategory | 'alle')}
        >
          <option value="alle">Gerätetypen · alle</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <select
          className={chipCls(availability !== 'alle')}
          style={{ padding: '5px 9px' }}
          value={availability}
          onChange={(e) => setAvailability(e.target.value as Availability)}
        >
          <option value="alle">Verfügbarkeit · alle</option>
          <option value="online">online</option>
          <option value="offline">offline</option>
        </select>
        <select
          className={chipCls(patchState !== 'alle')}
          style={{ padding: '5px 9px' }}
          value={patchState}
          onChange={(e) => setPatchState(e.target.value as PatchState)}
        >
          <option value="alle">Patch-Status · alle</option>
          <option value="offen">Updates offen</option>
          <option value="sicherheit">Sicherheitsupdates offen</option>
          <option value="aktuell">aktuell</option>
        </select>
        {(personFilter !== 'alle' || osFilter !== 'alle' || availability !== 'alle' || patchState !== 'alle') && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setPersonFilter('alle');
              setOsFilter('alle');
              setAvailability('alle');
              setPatchState('alle');
            }}
          >
            ✕ Filter zurücksetzen
          </button>
        )}
        <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {shown.length} von {devices.length} Geräten
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="empty">
          <h2>Keine Geräte</h2>
          <p className="muted">Enrolle Geräte, um Updates zentral zu sehen und zu installieren.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="tbl-scroll">
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 780 }}>
              <span>Gerät</span>
              <span>Person</span>
              <span>OS</span>
              <span style={{ textAlign: 'right' }}>Ausstehend</span>
              <span style={{ textAlign: 'right' }}>Sicherheit</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Aktion</span>
            </div>
            {shown.length === 0 ? (
              <div style={{ padding: '18px 16px' }} className="muted">
                Keine Geräte für diese Filter.
              </div>
            ) : (
              shown.map((d) => {
                const s = patchSummary[String(d.id)] ?? { pending: 0, security: 0 };
                const st = deviceState(d);
                return (
                  <div
                    key={d.id}
                    className="tbl-row"
                    style={{ gridTemplateColumns: COLS, cursor: 'default', minWidth: 780 }}
                  >
                    <span className="cell-name">
                      <Dot color={stateColor(st)} />
                      <span className="name">{d.hostname}</span>
                    </span>
                    <span style={{ color: 'var(--tx2)', fontWeight: 600 }}>
                      {personName(d.person_id) || d.owner_label || '—'}
                    </span>
                    <span style={{ color: 'var(--tx2)', fontWeight: 600 }}>{osLabel(d.os)}</span>
                    <span
                      className="mono"
                      style={{ textAlign: 'right', fontSize: 12, color: s.pending ? 'var(--tx)' : 'var(--tx3)' }}
                    >
                      {s.pending || '—'}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {s.security > 0 ? <span className="badge badge-danger">{s.security}</span> : '—'}
                    </span>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {d.online ? (s.pending ? 'Updates verfügbar' : 'aktuell') : 'offline'}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <button
                        className={s.pending ? 'btn btn-accent btn-sm' : 'btn btn-sm'}
                        onClick={() => onOpenDevice(d.id)}
                      >
                        {s.pending ? 'Installieren' : 'Scannen'}
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
