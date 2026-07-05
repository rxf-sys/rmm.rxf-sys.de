import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import { useJobStream } from '../hooks/useJobStream';
import type { Patch, Severity } from '../types';

interface Props {
  deviceId: number;
  connected: boolean;
}

const SEV_LABEL: Record<Severity, string> = {
  critical: 'kritisch',
  important: 'wichtig',
  moderate: 'mittel',
  low: 'niedrig',
  other: 'sonstige',
};

const SEV_CLASS: Record<Severity, string> = {
  critical: 'sev-critical',
  important: 'sev-important',
  moderate: 'sev-moderate',
  low: 'sev-low',
  other: 'sev-other',
};

export function PatchesPanel({ deviceId, connected }: Props) {
  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [installingJob, setInstallingJob] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const stream = useJobStream(installingJob);

  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .devicePatches(deviceId, signal)
        .then((r) => {
          setPatches(r.patches);
          // Adopt a server-side running install (e.g. after a page reload).
          if (r.installing_job !== null) setInstallingJob(r.installing_job);
        })
        .catch((e) => {
          if (!signal?.aborted) setError(apiErrorMessage(e));
        }),
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [stream.output]);

  // When an install finishes, the agent re-scans; refresh the list.
  useEffect(() => {
    if (stream.status === 'done' || stream.status === 'failed' || stream.status === 'timeout') {
      const t = setTimeout(() => void load(), 800);
      return () => clearTimeout(t);
    }
  }, [stream.status, load]);

  const scan = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.scanPatches(deviceId);
      // The report arrives async over the agent socket; poll briefly for it.
      setTimeout(() => void load(), 1200);
      setTimeout(() => void load(), 4000);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async (securityOnly: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.installPatches(deviceId, { security_only: securityOnly });
      setInstallingJob(r.job.id);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const securityCount = (patches ?? []).filter(
    (p) => p.severity === 'critical' || p.severity === 'important',
  ).length;
  const running = stream.status === 'running' || stream.status === 'queued';

  return (
    <div className="detail-card">
      <div className="chart-head">
        <h3>Updates {patches ? `(${patches.length})` : ''}</h3>
        <div className="cmd-actions">
          <button className="ghost" onClick={() => void scan()} disabled={busy || !connected}>
            Scannen
          </button>
          {securityCount > 0 && (
            <button onClick={() => void install(true)} disabled={busy || running || !connected}>
              Nur Sicherheit ({securityCount})
            </button>
          )}
          {patches && patches.length > 0 && (
            <button onClick={() => void install(false)} disabled={busy || running || !connected}>
              Alle installieren
            </button>
          )}
        </div>
      </div>

      {!connected && <p className="panel-muted">Gerät ist nicht verbunden.</p>}
      {error && <p className="panel-error">{error}</p>}
      {patches === null && <p className="panel-muted">Lade Updates…</p>}
      {patches && patches.length === 0 && !running && (
        <p className="panel-muted">Keine ausstehenden Updates — oder noch nicht gescannt.</p>
      )}

      {patches && patches.length > 0 && (
        <table className="patch-table">
          <tbody>
            {patches.map((p) => (
              <tr key={p.patch_id}>
                <td>
                  <span className={`sev-badge ${SEV_CLASS[p.severity]}`}>
                    {SEV_LABEL[p.severity]}
                  </span>
                </td>
                <td className="patch-title">{p.title}</td>
                <td className="job-meta">seit {formatRelative(p.detected_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {installingJob !== null && (
        <div className="console">
          <div className="console-head">
            <span>Installation (Job #{installingJob})</span>
            {stream.status && <span className="job-badge job-run">{stream.status}</span>}
          </div>
          <pre ref={outputRef} className="console-output">
            {stream.output || '…'}
          </pre>
        </div>
      )}
    </div>
  );
}
