import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { Device } from '../types';

const REFRESH_MS = 30_000;

function formatLastSeen(ts: number | null): string {
  if (!ts) return 'nie';
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (delta < 90) return 'gerade eben';
  if (delta < 3600) return `vor ${Math.floor(delta / 60)} min`;
  if (delta < 86400) return `vor ${Math.floor(delta / 3600)} h`;
  return new Date(ts * 1000).toLocaleString('de-DE');
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .devices(ctrl.signal)
        .then((r) => {
          setDevices(r.devices);
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

  if (error) return <p className="panel-error">Geräte konnten nicht geladen werden: {error}</p>;
  if (devices === null) return <p className="panel-muted">Lade Geräte…</p>;
  if (devices.length === 0) {
    return (
      <div className="empty-state">
        <h2>Noch keine Geräte</h2>
        <p>
          In Phase 1 kommt hier der „Gerät hinzufügen“-Flow: Einmal-Token erzeugen,
          Agent installieren, fertig.
        </p>
      </div>
    );
  }

  return (
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
          <tr key={d.id}>
            <td>
              <span className={d.online ? 'dot dot-online' : 'dot dot-offline'} />
              {d.online ? 'online' : 'offline'}
            </td>
            <td>{d.hostname}</td>
            <td>{d.owner_label || '—'}</td>
            <td>
              {d.os} {d.os_version}
            </td>
            <td>{d.agent_version || '—'}</td>
            <td>{formatLastSeen(d.last_seen_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
