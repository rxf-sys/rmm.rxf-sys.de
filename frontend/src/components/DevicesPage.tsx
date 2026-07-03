import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative, osLabel } from '../format';
import type { Device } from '../types';
import { DeviceDetail } from './DeviceDetail';
import { EnrollModal } from './EnrollModal';

interface Props {
  isAdmin: boolean;
}

const REFRESH_MS = 30_000;

export function DevicesPage({ isAdmin }: Props) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const load = (signal?: AbortSignal) =>
    api
      .devices(signal)
      .then((r) => {
        setDevices(r.devices);
        setError(null);
      })
      .catch((e) => {
        if (!signal?.aborted) setError(apiErrorMessage(e));
      });

  useEffect(() => {
    // Pause the list poll while a detail view is open — it runs its own.
    if (selected !== null) return;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => void load(ctrl.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [selected]);

  if (selected !== null) {
    return (
      <DeviceDetail
        deviceId={selected}
        isAdmin={isAdmin}
        onBack={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          void load();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h2>Geräte {devices ? `(${devices.length})` : ''}</h2>
        {isAdmin && <button onClick={() => setEnrolling(true)}>+ Gerät hinzufügen</button>}
      </div>

      {error && <p className="panel-error">{error}</p>}
      {devices === null && !error && <p className="panel-muted">Lade Geräte…</p>}

      {devices !== null && devices.length === 0 && (
        <div className="empty-state">
          <h2>Noch keine Geräte</h2>
          <p>
            {isAdmin
              ? 'Klicke „Gerät hinzufügen“, erzeuge ein Token und führe den Agent-Befehl auf dem Zielgerät aus.'
              : 'Es sind noch keine Geräte enrollt.'}
          </p>
        </div>
      )}

      {devices !== null && devices.length > 0 && (
        <table className="device-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Hostname</th>
              <th>Besitzer</th>
              <th>OS</th>
              <th>Agent</th>
              <th>Zuletzt gesehen</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => setSelected(d.id)}>
                <td>
                  <span className={d.online ? 'dot dot-online' : 'dot dot-offline'} />
                  {d.online ? 'online' : 'offline'}
                </td>
                <td>{d.hostname}</td>
                <td>{d.owner_label || '—'}</td>
                <td>
                  {osLabel(d.os)} {d.os_version}
                </td>
                <td>{d.agent_version || '—'}</td>
                <td>{formatRelative(d.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {enrolling && (
        <EnrollModal
          onClose={() => {
            setEnrolling(false);
            void load();
          }}
        />
      )}
    </>
  );
}
