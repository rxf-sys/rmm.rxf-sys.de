import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { AuditEvent } from '../types';
import { describeAudit } from '../auditText';

const REFRESH_MS = 30_000;

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

  return (
    <div className="screen">
      <div className="page-head">
        <h1 className="page-title">Audit-Log</h1>
        <span className="muted">append-only · jede Aktion mit Akteur, Gerät und Zeitstempel</span>
      </div>
      {error && <p className="err">{error}</p>}
      {events === null ? (
        <div className="card" style={{ padding: 16 }} />
      ) : events.length === 0 ? (
        <div className="empty">
          <h2>Noch keine Ereignisse</h2>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {events.map((e) => {
            const actorColor =
              e.actor === 'system' || !e.actor
                ? { color: 'var(--violet)', background: 'color-mix(in srgb, var(--violet) 15%, transparent)' }
                : { color: 'var(--accT)', background: 'var(--accBg)' };
            return (
              <div
                key={e.id}
                className="row"
                style={{ gap: 14, padding: '9px 18px', borderBottom: '1px solid var(--line2)' }}
              >
                <span className="mono" style={{ flex: 'none', fontSize: 11, color: 'var(--tx3)', width: 118 }}>
                  {new Date(e.ts * 1000).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className="badge"
                  style={{ flex: 'none', width: 64, textAlign: 'center', ...actorColor }}
                >
                  {e.actor || 'system'}
                </span>
                <span className="mono" style={{ flex: 'none', fontSize: 10, color: 'var(--tx3)', width: 140 }}>
                  {e.event}
                </span>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{describeAudit(e)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
