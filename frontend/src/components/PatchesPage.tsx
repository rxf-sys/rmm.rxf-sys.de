import { osLabel } from '../format';
import type { Device, PatchSummary } from '../types';
import { Dot, deviceState, stateColor } from '../ui';

interface Props {
  devices: Device[];
  patchSummary: PatchSummary;
  onOpenDevice: (id: number) => void;
}

const COLS = '16fr 8fr 8fr 8fr 10fr 10fr';

export function PatchesPage({ devices, patchSummary, onOpenDevice }: Props) {
  const totalPending = Object.values(patchSummary).reduce((a, s) => a + s.pending, 0);
  const totalSecurity = Object.values(patchSummary).reduce((a, s) => a + s.security, 0);
  const withPatches = Object.values(patchSummary).filter((s) => s.pending > 0).length;
  const compliance = devices.length
    ? Math.round(((devices.length - withPatches) / devices.length) * 100)
    : 100;

  const sorted = [...devices].sort((a, b) => {
    const sa = patchSummary[String(a.id)]?.pending ?? 0;
    const sb = patchSummary[String(b.id)]?.pending ?? 0;
    return sb - sa;
  });

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Patch-Management</h1>
        <span className="muted">
          {totalPending} Updates offen · {totalSecurity} sicherheitskritisch · Compliance {compliance} %
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
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 700 }}>
              <span>Gerät</span>
              <span>OS</span>
              <span style={{ textAlign: 'right' }}>Ausstehend</span>
              <span style={{ textAlign: 'right' }}>Sicherheit</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Aktion</span>
            </div>
            {sorted.map((d) => {
              const s = patchSummary[String(d.id)] ?? { pending: 0, security: 0 };
              const st = deviceState(d);
              return (
                <div
                  key={d.id}
                  className="tbl-row"
                  style={{ gridTemplateColumns: COLS, cursor: 'default', minWidth: 700 }}
                >
                  <span className="cell-name">
                    <Dot color={stateColor(st)} />
                    <span className="name">{d.hostname}</span>
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}
