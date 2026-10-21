import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { formatAgo, formatDateTime } from '../../../format';
import { useConfirm } from '../../../hooks/useConfirm';
import { IconRestart, IconStatusOk } from '../../../icons';
import type { Severity } from '../../../types';
import { EmptyState, ErrorNote, Panel, SkeletonRows, StatusBadge, type StatusKind } from '../../../ui';
import { notify } from '../../../ui/toast';
import { JobConsole } from '../JobConsole';
import { QueuedActions } from '../QueuedActions';

/** Order of urgency — also the order of the summary. */
const SEV_RANK: Severity[] = ['critical', 'important', 'moderate', 'low', 'other'];
const SEV_LABEL: Record<Severity, string> = {
  critical: 'Kritisch',
  important: 'Wichtig',
  moderate: 'Mittel',
  low: 'Niedrig',
  other: 'Sonstige',
};
const SEV_KIND: Record<Severity, StatusKind> = {
  critical: 'danger',
  important: 'warn',
  moderate: 'info',
  low: 'neutral',
  other: 'neutral',
};

/** Pending updates of one device, most urgent first, and their installation. */
export function UpdatesTab({
  deviceId,
  connected,
  os,
  isOperator,
}: {
  deviceId: number;
  connected: boolean;
  os: string;
  isOperator: boolean;
}) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [startedJob, setStartedJob] = useState<number | null>(null);
  const q = useQuery({
    queryKey: qk.devicePatches(deviceId),
    queryFn: ({ signal }) => api.devicePatches(deviceId, signal),
  });
  // A run started elsewhere (another tab, the patch window) shows up too.
  const installingJob = startedJob ?? q.data?.installing_job ?? null;
  const reload = useCallback(() => void qc.invalidateQueries({ queryKey: qk.devicePatches(deviceId) }), [qc, deviceId]);

  const scan = async () => {
    setBusy(true);
    try {
      await api.scanPatches(deviceId);
      notify.info('Suche nach Updates gestartet', 'Das Ergebnis erscheint hier, sobald der Agent es meldet.');
      setTimeout(reload, 1500);
      setTimeout(reload, 5000);
    } catch (e) {
      notify.error('Suche nicht gestartet', e);
    } finally {
      setBusy(false);
    }
  };

  const install = async (securityOnly: boolean) => {
    const ok = await ask({
      title: securityOnly ? 'Sicherheitsupdates installieren?' : 'Alle Updates installieren?',
      body: 'Die Installation läuft auf dem Gerät und kann dauern. Manche Updates erzwingen einen Neustart — wer gerade davor sitzt, verliert ungespeicherte Arbeit.',
      confirmLabel: 'Installation starten',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.installPatches(deviceId, { security_only: securityOnly });
      setStartedJob(r.job.id);
    } catch (e) {
      notify.error('Installation nicht gestartet', e);
    } finally {
      setBusy(false);
    }
  };

  const patches = q.data?.patches ?? [];
  const lastScan = q.data?.last_scan_at ?? 0;
  const security = patches.filter((p) => p.severity === 'critical' || p.severity === 'important').length;
  // The agent's order is arbitrary; what has to go in first goes on top.
  const sorted = [...patches].sort((a, b) => SEV_RANK.indexOf(a.severity) - SEV_RANK.indexOf(b.severity));
  const counts = SEV_RANK.map((s) => [s, patches.filter((p) => p.severity === s).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="dv-stack">
      {confirmDialog}
      <Panel
        title="Ausstehende Updates"
        meta={
          q.data &&
          // Without the date an empty list reads as "all current" even when
          // nobody ever looked.
          (lastScan ? <span title={formatDateTime(lastScan)}>zuletzt geprüft {formatAgo(lastScan)}</span> : 'noch nie geprüft')
        }
        padded={false}
        actions={
          isOperator && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => void scan()} disabled={busy || !connected}>
                <IconRestart size={14} /> Jetzt prüfen
              </button>
              {security > 0 && (
                <button type="button" className="btn btn-sm btn-warn" onClick={() => void install(true)} disabled={busy || installingJob !== null || !connected}>
                  Nur Sicherheit ({security})
                </button>
              )}
              {patches.length > 0 && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void install(false)} disabled={busy || installingJob !== null || !connected}>
                  Alle installieren
                </button>
              )}
            </>
          )
        }
      >
        {!connected && isOperator && (
          <p className="dv-pad dv-note">
            Gerät nicht verbunden — prüfen und sofort installieren geht erst wieder, wenn es sich meldet. Die Installation lässt sich
            unten fürs nächste Online-Gehen vormerken.
          </p>
        )}
        {q.error ? (
          <div className="dv-pad">
            <ErrorNote error={q.error} onRetry={reload} />
          </div>
        ) : q.isPending ? (
          <div className="dv-pad">
            <SkeletonRows rows={3} />
          </div>
        ) : patches.length === 0 ? (
          <EmptyState icon={<IconStatusOk size={22} />} title={lastScan ? 'Alles aktuell' : 'Noch nicht geprüft'}>
            {lastScan
              ? `Keine ausstehenden Updates — zuletzt geprüft ${formatAgo(lastScan)}.`
              : 'Die tägliche Prüfung holt das bei der nächsten Meldung des Geräts nach.'}
          </EmptyState>
        ) : (
          <>
            <p className="dv-pad dv-sevs">
              {counts.map(([s, n]) => (
                <StatusBadge key={s} kind={SEV_KIND[s]} label={`${n} ${SEV_LABEL[s]}`} />
              ))}
            </p>
            <div className="dv-scroll">
              <table className="dv-table">
                <thead>
                  <tr>
                    <th scope="col" className="dv-sev-col">
                      Dringlichkeit
                    </th>
                    <th scope="col">Update</th>
                    <th scope="col" className="dv-hide-narrow">
                      Kennung
                    </th>
                    <th scope="col" className="dv-r dv-hide-narrow">
                      Bekannt seit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.patch_id}>
                      <td>
                        <StatusBadge kind={SEV_KIND[p.severity]} label={SEV_LABEL[p.severity]} />
                      </td>
                      <td className="dv-strong">{p.title}</td>
                      <td className="dv-hide-narrow num muted">{p.patch_id}</td>
                      <td className="dv-r muted dv-hide-narrow" title={formatDateTime(p.detected_at)}>
                        {formatAgo(p.detected_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      {isOperator && <QueuedActions device={{ id: deviceId, os, connected }} mode="updates" />}
      {installingJob !== null && !isOperator && (
        // The job output socket is operator-only; viewers get the fact, not
        // a console that can never connect.
        <p className="dv-note" role="status">
          Auf diesem Gerät läuft gerade eine Update-Installation.
        </p>
      )}
      {installingJob !== null && isOperator && (
        <JobConsole
          jobId={installingJob}
          title={`Installation · Auftrag #${installingJob}`}
          onFinished={(status) => {
            notify[status === 'done' ? 'success' : 'warning'](status === 'done' ? 'Updates installiert' : 'Installation nicht vollständig', 'Die Liste wird neu geladen.');
            setTimeout(reload, 800);
          }}
        />
      )}
    </div>
  );
}
