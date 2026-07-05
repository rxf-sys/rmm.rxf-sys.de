import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { osLabel } from '../format';
import type { Device, PatchSummary } from '../types';

interface Props {
  onOpenDevice: (id: number) => void;
}

const REFRESH_MS = 30_000;

export function PatchesPage({ onOpenDevice }: Props) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [summary, setSummary] = useState<PatchSummary>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      Promise.all([api.devices(ctrl.signal), api.patchSummary(ctrl.signal)])
        .then(([d, s]) => {
          setDevices(d.devices);
          setSummary(s.summary);
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
  if (devices === null) return <p className="panel-muted">Lade Patch-Übersicht…</p>;

  const totalSecurity = Object.values(summary).reduce((a, s) => a + s.security, 0);

  return (
    <>
      <div className="page-head">
        <h2>Patches</h2>
        <span className="panel-muted">
          {totalSecurity > 0
            ? `${totalSecurity} Sicherheitsupdates flottenweit offen`
            : 'keine offenen Sicherheitsupdates'}
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="empty-state">
          <h2>Keine Geräte</h2>
          <p>Enrolle Geräte, dann kannst du hier Updates zentral sehen und installieren.</p>
        </div>
      ) : (
        <table className="device-table">
          <thead>
            <tr>
              <th>Gerät</th>
              <th>OS</th>
              <th>Ausstehend</th>
              <th>davon Sicherheit</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const s = summary[String(d.id)] ?? { pending: 0, security: 0 };
              return (
                <tr key={d.id} className="clickable" onClick={() => onOpenDevice(d.id)}>
                  <td>
                    {d.hostname}
                    {d.owner_label ? ` · ${d.owner_label}` : ''}
                  </td>
                  <td>{osLabel(d.os)}</td>
                  <td>{s.pending || '—'}</td>
                  <td>
                    {s.security > 0 ? (
                      <span className="sev-badge sev-important">{s.security}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
