import { useState } from 'react';
import { api } from '../../../api/client';
import { IconCheck, IconCopy, IconRestart } from '../../../icons';
import { EmptyState, ErrorNote, Panel } from '../../../ui';

/** The agent's most recent log lines, fetched live and never stored. */
export function DiagnosticsTab({ deviceId, connected }: { deviceId: number; connected: boolean }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetchLogs = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.agentLogs(deviceId);
      setLines(r.lines);
      setCopied(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Agent-Protokoll"
      meta="die letzten Zeilen direkt vom Agent — sie werden nirgends gespeichert"
      actions={
        <button type="button" className="btn btn-sm" onClick={() => void fetchLogs()} disabled={busy || !connected}>
          <IconRestart size={14} /> {busy ? 'Lädt …' : lines === null ? 'Abrufen' : 'Neu abrufen'}
        </button>
      }
    >
      {error !== null && <ErrorNote error={error} onRetry={() => void fetchLogs()} />}
      {!connected ? (
        <EmptyState title="Gerät nicht verbunden">Das Protokoll lässt sich nur bei laufendem Agent abrufen.</EmptyState>
      ) : lines === null ? (
        <p className="dv-note">
          Der Agent hält die letzten Zeilen im Speicher. „Abrufen" holt sie — ein zweiter Abruf kann andere Zeilen zeigen.
        </p>
      ) : (
        <div className="console">
          <div className="console-head">
            <span className="console-title">rmm-agent · {lines.length} Zeilen</span>
            {lines.length > 0 && (
              <span className="console-actions">
                <button
                  type="button"
                  className="console-btn"
                  onClick={() =>
                    void navigator.clipboard?.writeText(lines.join('\n')).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  {copied ? <IconCheck size={13} /> : <IconCopy size={13} />} {copied ? 'Kopiert' : 'Kopieren'}
                </button>
              </span>
            )}
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the log scrolls; keyboard users need to reach it to scroll. */}
          <div className="console-body dv-log" role="log" aria-label="Agent-Protokoll" tabIndex={0}>
            {lines.length === 0 ? (
              <span className="console-line console-muted">Keine Zeilen gepuffert.</span>
            ) : (
              lines.map((l, i) => (
                <span key={i} className="console-line">
                  {l}
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
