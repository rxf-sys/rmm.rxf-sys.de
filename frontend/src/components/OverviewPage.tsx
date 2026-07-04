import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative, osLabel } from '../format';
import type { Alert, Device } from '../types';

interface Props {
  onOpenDevice: (id: number) => void;
}

const REFRESH_MS = 30_000;

function deviceState(d: Device): 'ok' | 'warn' | 'down' {
  if (!d.online) return d.last_seen_at === null ? 'warn' : 'down';
  const maxDisk = Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct));
  return maxDisk >= 90 ? 'warn' : 'ok';
}

const STATE_LABEL = { ok: 'online', warn: 'Achtung', down: 'offline' } as const;

export function OverviewPage({ onOpenDevice }: Props) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      Promise.all([api.devices(ctrl.signal), api.alerts(ctrl.signal)])
        .then(([d, a]) => {
          setDevices(d.devices);
          setAlerts(a.alerts);
          setError(null);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(apiErrorMessage(e));
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, []);

  if (error) return <p className="panel-error">{error}</p>;
  if (devices === null) return <p className="panel-muted">Lade Übersicht…</p>;

  const open = alerts.filter((a) => a.resolved_at === null);
  const recent = alerts.filter((a) => a.resolved_at !== null).slice(0, 5);
  const down = devices.filter((d) => deviceState(d) === 'down').length;

  return (
    <>
      <div className="page-head">
        <h2>Übersicht</h2>
        <span className="panel-muted">
          {devices.length} Geräte · {devices.length - down} online
          {open.length > 0 ? ` · ${open.length} offene Alarme` : ''}
        </span>
      </div>

      {devices.length === 0 && (
        <div className="empty-state">
          <h2>Noch keine Geräte</h2>
          <p>Füge im Tab „Geräte“ dein erstes Gerät hinzu.</p>
        </div>
      )}

      <div className="overview-grid">
        {devices.map((d) => {
          const state = deviceState(d);
          return (
            <button key={d.id} className={`overview-card state-${state}`} onClick={() => onOpenDevice(d.id)}>
              <div className="card-title">
                <span className={`dot dot-${state === 'ok' ? 'online' : state === 'down' ? 'offline' : 'warn'}`} />
                <strong>{d.hostname}</strong>
                <span className="badge">{osLabel(d.os)}</span>
              </div>
              <div className="card-sub">
                {d.owner_label || '—'} · {STATE_LABEL[state]}
                {state !== 'ok' ? ` · zuletzt ${formatRelative(d.last_seen_at)}` : ''}
              </div>
              {d.online && (
                <div className="card-metrics">
                  CPU {Math.round(d.heartbeat.cpu_pct ?? 0)}% · RAM {Math.round(d.heartbeat.mem_pct ?? 0)}% · Disk{' '}
                  {Math.round(Math.max(0, ...(d.heartbeat.disks ?? []).map((x) => x.used_pct)))}%
                </div>
              )}
            </button>
          );
        })}
      </div>

      {(open.length > 0 || recent.length > 0) && (
        <div className="detail-card">
          <h3>Alarme</h3>
          {open.length === 0 && <p className="panel-muted">Keine offenen Alarme.</p>}
          {open.map((a) => (
            <div key={a.id} className="alert-row alert-open">
              <span className="dot dot-offline" style={{ background: 'var(--danger)' }} />
              <span className="alert-msg">{a.message}</span>
              <span className="alert-ts">{formatRelative(a.fired_at)}</span>
            </div>
          ))}
          {recent.map((a) => (
            <div key={a.id} className="alert-row alert-resolved">
              <span className="dot dot-online" />
              <span className="alert-msg">{a.message}</span>
              <span className="alert-ts">behoben {formatRelative(a.resolved_at)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
