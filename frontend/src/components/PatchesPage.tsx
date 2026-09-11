import { useMemo, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative, osLabel } from '../format';
import type { Device, PatchSummary, Person } from '../types';
import { Dot } from '../ui';
import { deviceState, stateColor } from '../deviceStatus';
import { usePagination } from '../hooks/usePagination';
import { FilterBar, type FilterOption } from './FilterBar';
import { Pagination } from './Pagination';
import type { ReactNode } from 'react';
import { AppleLogo, LinuxLogo, ServerRack, WindowsLogo } from '../icons';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  persons: Person[];
  onOpenDevice: (id: number) => void;
  /** Nach einem Scan-Auftrag die Flottendaten neu holen. */
  onRefresh: () => void;
  isOperator: boolean;
}

const COLS = '16fr 8fr 7fr 7fr 7fr 10fr 10fr 10fr';

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

const STATE_LABEL: Record<PatchState, string> = {
  alle: 'Alle',
  sicherheit: 'Sicherheit',
  offen: 'Updates offen',
  aktuell: 'Aktuell',
  ungeprueft: 'Nie geprüft',
};
type PatchState = 'alle' | 'sicherheit' | 'offen' | 'aktuell' | 'ungeprueft';

export function PatchesPage({
  devices,
  patchSummary,
  persons,
  onOpenDevice,
  onRefresh,
  isOperator,
}: Props) {
  const [personFilter, setPersonFilter] = useState<number | 'alle'>('alle');
  // Gerät, für das gerade ein Scan angefordert wurde, und der letzte Fehler.
  const [scanning, setScanning] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const scanAll = async () => {
    setScanning(-1);
    setScanError(null);
    try {
      // Nacheinander statt parallel: der Server schickt jede Anfrage über den
      // offenen Agent-Socket, und eine Fehlermeldung soll das Gerät benennen.
      for (const d of scannable) await api.scanPatches(d.id);
      setTimeout(onRefresh, 2500);
    } catch (e) {
      setScanError(apiErrorMessage(e));
    } finally {
      setScanning(null);
    }
  };

  const scan = async (id: number) => {
    setScanning(id);
    setScanError(null);
    try {
      await api.scanPatches(id);
      // Der Bericht kommt asynchron über den Agent-Socket; kurz warten und
      // dann neu laden, statt dem Nutzer ein leeres Ergebnis zu zeigen.
      setTimeout(onRefresh, 2500);
    } catch (e) {
      setScanError(apiErrorMessage(e));
    } finally {
      setScanning(null);
    }
  };
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

  /** Ein Prädikat je Filter — damit die Zahl an der Leiste und die Zeilen
   *  darunter nie etwas Verschiedenes behaupten. */
  const matchesState = (d: Device, f: PatchState) => {
    switch (f) {
      case 'sicherheit':
        return security(d) > 0;
      case 'offen':
        return pending(d) > 0;
      case 'aktuell':
        return pending(d) === 0 && d.last_patch_scan_at > 0;
      case 'ungeprueft':
        // Nie ein Bericht eingetroffen: „aktuell" wäre hier eine Behauptung.
        return d.last_patch_scan_at === 0;
      default:
        return true;
    }
  };

  // Person, Gerätetyp und Verfügbarkeit engen die Menge ein, über die die
  // Statusleiste zählt.
  const base = useMemo(
    () =>
      devices.filter((d) => {
        if (personFilter !== 'alle' && d.person_id !== personFilter) return false;
        if (osFilter !== 'alle' && categoryOf(d) !== osFilter) return false;
        if (availability === 'online' && !d.online) return false;
        if (availability === 'offline' && d.online) return false;
        return true;
      }),
    [devices, personFilter, osFilter, availability],
  );

  const shown = useMemo(
    () => [...base].filter((d) => matchesState(d, patchState)).sort((a, b) => pending(b) - pending(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, patchSummary, patchState],
  );

  const stateOptions: FilterOption<PatchState>[] = (
    ['alle', 'sicherheit', 'offen', 'aktuell', 'ungeprueft'] as PatchState[]
  ).map((id) => ({
    id,
    label: STATE_LABEL[id],
    count: id === 'alle' ? undefined : base.filter((d) => matchesState(d, id)).length,
    tone:
      id === 'sicherheit' ? 'danger' : id === 'offen' ? 'warn' : id === 'aktuell' ? 'ok' : 'neutral',
  }));

  const osOptions: FilterOption<OsCategory | 'alle'>[] = [
    { id: 'alle' as const, label: 'Alle Typen' },
    ...CATEGORIES.map((c) => ({
      id: c.id as OsCategory | 'alle',
      label: c.label,
      icon: c.icon,
      count: devices.filter((d) => categoryOf(d) === c.id).length,
    })),
  ];

  // Was sich gerade überhaupt scannen lässt: online, in der aktuellen Auswahl.
  const scannable = shown.filter((d) => d.online);

  const pager = usePagination(
    shown,
    'patches',
    `${personFilter}|${osFilter}|${availability}|${patchState}`,
  );

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

      {/* Filter: dieselbe segmentierte Leiste wie auf der Geräteseite und im
          Audit-Log, mit Trefferzahlen. Vier gleich aussehende Klappfelder
          sagten vorab nichts darüber, was ein Filter übrig lässt. */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <FilterBar
          options={stateOptions}
          value={patchState}
          onChange={setPatchState}
          label="Nach Patch-Status filtern"
        />
        <FilterBar
          options={osOptions}
          value={osFilter}
          onChange={setOsFilter}
          label="Nach Gerätetyp filtern"
        />
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {persons.length > 0 && (
          <select
            className={chipCls(personFilter !== 'alle')}
            style={{ padding: '5px 9px' }}
            value={personFilter}
            aria-label="Nach Person filtern"
            onChange={(e) =>
              setPersonFilter(e.target.value === 'alle' ? 'alle' : Number(e.target.value))
            }
          >
            <option value="alle">Personen · alle</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select
          className={chipCls(availability !== 'alle')}
          style={{ padding: '5px 9px' }}
          value={availability}
          aria-label="Nach Verfügbarkeit filtern"
          onChange={(e) => setAvailability(e.target.value as Availability)}
        >
          <option value="alle">Verfügbarkeit · alle</option>
          <option value="online">online</option>
          <option value="offline">offline</option>
        </select>
        {(personFilter !== 'alle' ||
          osFilter !== 'alle' ||
          availability !== 'alle' ||
          patchState !== 'alle') && (
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
        {isOperator && scannable.length > 0 && (
          <button
            className="btn btn-sm"
            style={{ marginLeft: 'auto' }}
            disabled={scanning !== null}
            title="Fordert bei allen online erreichbaren Geräten der Auswahl einen Update-Scan an"
            onClick={() => void scanAll()}
          >
            {scanning === -1 ? 'Scannt…' : `${scannable.length} Geräte scannen`}
          </button>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: isOperator ? 0 : 'auto' }}>
          {shown.length} von {devices.length} Geräten
        </span>
      </div>

      {scanError && <p className="err">{scanError}</p>}

      {devices.length === 0 ? (
        <div className="empty">
          <h2>Keine Geräte</h2>
          <p className="muted">Enrolle Geräte, um Updates zentral zu sehen und zu installieren.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="tbl-scroll">
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 880 }}>
              <span>Gerät</span>
              <span>Person</span>
              <span>OS</span>
              <span style={{ textAlign: 'right' }}>Ausstehend</span>
              <span style={{ textAlign: 'right' }}>Sicherheit</span>
              <span>Zuletzt geprüft</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Aktion</span>
            </div>
            {shown.length === 0 ? (
              <div style={{ padding: '18px 16px' }} className="muted">
                Keine Geräte für diese Filter.
              </div>
            ) : (
              pager.items.map((d) => {
                const s = patchSummary[String(d.id)] ?? { pending: 0, security: 0 };
                const st = deviceState(d);
                return (
                  <div
                    key={d.id}
                    className="tbl-row"
                    style={{ gridTemplateColumns: COLS, cursor: 'default', minWidth: 880 }}
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
                    <span
                      className="muted"
                      style={{ fontSize: 11.5, color: d.last_patch_scan_at ? undefined : 'var(--warn)' }}
                    >
                      {d.last_patch_scan_at ? formatRelative(d.last_patch_scan_at) : 'nie'}
                    </span>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {!d.online
                        ? 'offline'
                        : s.pending
                          ? 'Updates verfügbar'
                          : d.last_patch_scan_at
                            ? 'aktuell'
                            : 'nicht geprüft'}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {s.pending > 0 ? (
                        <button className="btn btn-accent btn-sm" onClick={() => onOpenDevice(d.id)}>
                          Installieren
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          disabled={!isOperator || !d.online || scanning === d.id}
                          title={
                            d.online
                              ? 'Update-Scan jetzt anfordern'
                              : 'Ein Scan braucht eine offene Agent-Verbindung'
                          }
                          onClick={() => void scan(d.id)}
                        >
                          {scanning === d.id ? 'Scannt…' : 'Scannen'}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <Pagination {...pager} label="Geräte" />
        </div>
      )}
    </div>
  );
}
