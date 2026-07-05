import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import { useJobStream } from '../hooks/useJobStream';
import type { Job, JobStatus, Script, Shell } from '../types';

interface Props {
  deviceId: number;
  deviceOs: string;
  connected: boolean;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'wartet',
  running: 'läuft',
  done: 'fertig',
  failed: 'fehlgeschlagen',
  timeout: 'Timeout',
};

function statusClass(status: JobStatus | null): string {
  if (status === 'done') return 'job-ok';
  if (status === 'failed' || status === 'timeout') return 'job-bad';
  if (status === 'running' || status === 'queued') return 'job-run';
  return '';
}

const DEFAULT_SHELL = (os: string): Shell => (os === 'windows' ? 'powershell' : 'bash');

export function JobsPanel({ deviceId, deviceOs, connected }: Props) {
  const [command, setCommand] = useState('');
  const [shell, setShell] = useState<Shell>(DEFAULT_SHELL(deviceOs));
  const [scripts, setScripts] = useState<Script[]>([]);
  const [history, setHistory] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const stream = useJobStream(activeJob);

  const loadHistory = useCallback(
    (signal?: AbortSignal) =>
      api
        .deviceJobs(deviceId, signal)
        .then((r) => setHistory(r.jobs))
        .catch(() => {
          /* history is non-critical */
        }),
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadHistory(ctrl.signal);
    void api
      .scripts(ctrl.signal)
      .then((r) => setScripts(r.scripts))
      .catch(() => {
        /* ignore */
      });
    return () => ctrl.abort();
  }, [loadHistory]);

  // Auto-scroll the console as output streams in.
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [stream.output]);

  // When a job finishes, refresh the history list so it shows the final state.
  useEffect(() => {
    if (stream.status === 'done' || stream.status === 'failed' || stream.status === 'timeout') {
      void loadHistory();
    }
  }, [stream.status, loadHistory]);

  const runShell = async () => {
    if (busy || !command.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.createShellJob(deviceId, command.trim(), shell);
      setActiveJob(r.job.id);
      void loadHistory();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runScript = async (scriptId: number) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.createScriptJob(deviceId, scriptId);
      setActiveJob(r.job.id);
      void loadHistory();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-card">
      <h3>Remote-Shell</h3>
      {!connected && (
        <p className="panel-muted">
          Gerät ist nicht verbunden — Befehle schlagen fehl, bis der Agent wieder online ist.
        </p>
      )}

      <div className="shell-row">
        <select value={shell} onChange={(e) => setShell(e.target.value as Shell)}>
          <option value="bash">bash</option>
          <option value="zsh">zsh</option>
          <option value="powershell">powershell</option>
        </select>
        <input
          className="shell-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runShell();
          }}
          placeholder="Befehl eingeben und Enter…"
          spellCheck={false}
        />
        <button onClick={() => void runShell()} disabled={busy || !command.trim()}>
          Ausführen
        </button>
      </div>

      {scripts.length > 0 && (
        <div className="script-run-row">
          <span className="panel-muted">Skript ausführen:</span>
          {scripts.map((s) => (
            <button key={s.id} className="chip" onClick={() => void runScript(s.id)} disabled={busy}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="panel-error">{error}</p>}

      {activeJob !== null && (
        <div className="console">
          <div className="console-head">
            <span>Job #{activeJob}</span>
            {stream.status && (
              <span className={`job-badge ${statusClass(stream.status)}`}>
                {STATUS_LABEL[stream.status]}
                {stream.exitCode !== null ? ` · exit ${stream.exitCode}` : ''}
              </span>
            )}
          </div>
          <pre ref={outputRef} className="console-output">
            {stream.output || (stream.status === 'running' ? '…' : '')}
          </pre>
        </div>
      )}

      {history.length > 0 && (
        <div className="job-history">
          <h4>Verlauf</h4>
          {history.map((j) => (
            <button
              key={j.id}
              className={`job-history-row ${activeJob === j.id ? 'active' : ''}`}
              onClick={() => setActiveJob(j.id)}
            >
              <span className={`job-badge ${statusClass(j.status)}`}>{STATUS_LABEL[j.status]}</span>
              <span className="job-cmd">
                {j.kind === 'script' ? `📜 ${j.script_name}` : j.command}
              </span>
              <span className="job-meta">
                {j.created_by} · {formatRelative(j.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
