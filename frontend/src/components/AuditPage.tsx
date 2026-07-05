import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatDateTime } from '../format';
import type { AuditEvent } from '../types';

const REFRESH_MS = 30_000;

/** Human summary of an audit row from its event type + detail blob. */
function describe(e: AuditEvent): string {
  const d = e.detail;
  switch (e.event) {
    case 'auth.login':
      return `Login von ${e.actor}${d.ip ? ` (${d.ip})` : ''}`;
    case 'agent.enrolled':
      return `Gerät enrollt: ${d.hostname ?? ''} (${d.os ?? ''})`;
    case 'job.created':
      return d.kind === 'script'
        ? `Skript „${d.script}" ausgeführt auf Gerät ${e.device_id}`
        : `Befehl auf Gerät ${e.device_id}: ${d.command ?? ''}`;
    case 'script.created':
      return `Skript angelegt: ${d.name ?? ''}`;
    case 'script.updated':
      return `Skript #${d.script_id} geändert`;
    case 'script.deleted':
      return `Skript #${d.script_id} gelöscht`;
    case 'devices.token_created':
      return `Enrollment-Token erzeugt${d.label ? ` (${d.label})` : ''}`;
    case 'devices.token_deleted':
      return `Enrollment-Token widerrufen`;
    case 'devices.updated':
      return `Gerät ${e.device_id} bearbeitet`;
    case 'devices.deleted':
      return `Gerät ${e.device_id} entfernt`;
    case 'alert.fired':
      return `Alarm: ${d.message ?? d.rule ?? ''}`;
    default:
      return e.event;
  }
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .audit(200, ctrl.signal)
        .then((r) => {
          setEvents(r.events);
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
  if (events === null) return <p className="panel-muted">Lade Audit-Log…</p>;

  return (
    <>
      <div className="page-head">
        <h2>Audit-Log</h2>
        <span className="panel-muted">letzte {events.length} Ereignisse</span>
      </div>
      {events.length === 0 ? (
        <div className="empty-state">
          <h2>Noch keine Ereignisse</h2>
        </div>
      ) : (
        <table className="device-table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Akteur</th>
              <th>Ereignis</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="audit-time">{formatDateTime(e.ts)}</td>
                <td>{e.actor || '—'}</td>
                <td>{describe(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
