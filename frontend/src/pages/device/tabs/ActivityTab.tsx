import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { auditDayLabel } from '../../../auditText';
import { FilterBar } from '../../../components/FilterBar';
import { formatDateTime } from '../../../format';
import { IconChevronDown, IconChevronRight, IconHistory } from '../../../icons';
import { EmptyState, ErrorNote, Panel, SkeletonRows, StatusBadge, type StatusKind } from '../../../ui';
import { JobConsole } from '../JobConsole';
import { JOB_STATUS_LABEL } from '../jobStatus';
import { buildTimeline, byDay, jobTitle, type TimelineEntry, type TimelineKind } from '../timeline';
import type { JobStatus } from '../../../types';

type Show = 'all' | TimelineKind;

const JOB_KIND: Record<JobStatus, StatusKind> = {
  queued: 'info',
  running: 'info',
  done: 'ok',
  failed: 'danger',
  timeout: 'danger',
};

const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function Entry({ e, open, onToggle }: { e: TimelineEntry; open: boolean; onToggle: () => void }) {
  if (e.kind === 'job') {
    const j = e.job;
    return (
      <li className={open ? 'tl-item is-open' : 'tl-item'} id={`job-${j.id}`}>
        <time className="tl-time" dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>
          {time(e.ts)}
        </time>
        <div className="tl-body">
          <button type="button" className="tl-toggle" aria-expanded={open} onClick={onToggle}>
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <span className={j.kind === 'shell' ? 'tl-title tl-cmd' : 'tl-title'}>{jobTitle(j)}</span>
          </button>
          <div className="tl-meta">
            <StatusBadge kind={JOB_KIND[j.status]} label={`${JOB_STATUS_LABEL[j.status]}${j.exit_code !== null && j.status !== 'done' ? ` · Exit ${j.exit_code}` : ''}`} />
            <span>{j.created_by || 'Automatik'}</span>
          </div>
          {open && <JobConsole jobId={j.id} title={`Auftrag #${j.id}`} />}
        </div>
      </li>
    );
  }
  if (e.kind === 'alert') {
    return (
      <li className="tl-item">
        <time className="tl-time" dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>
          {time(e.ts)}
        </time>
        <div className="tl-body">
          <span className="tl-title">{e.resolved ? `Behoben: ${e.alert.message}` : e.alert.message}</span>
          <div className="tl-meta">
            <StatusBadge
              kind={e.resolved ? 'ok' : e.alert.rule === 'offline' ? 'off' : 'warn'}
              label={e.resolved ? 'Alarm behoben' : 'Alarm'}
            />
            {!e.resolved && e.alert.acked_by && <span>bestätigt von {e.alert.acked_by}</span>}
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className="tl-item">
      <time className="tl-time" dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>
        {time(e.ts)}
      </time>
      <div className="tl-body">
        <span className="tl-title">{e.text}</span>
        <div className="tl-meta">
          <StatusBadge kind="neutral" label="Änderung" />
          {e.actor && <span>{e.actor}</span>}
        </div>
      </div>
    </li>
  );
}

/**
 * Everything that happened to this device, newest first: jobs with their
 * output a click away, alerts as they fired and cleared, and changes from the
 * audit log for admins. `?job=` opens a job directly — the link toasts and
 * the notification centre use.
 */
export function ActivityTab({ deviceId, isAdmin }: { deviceId: number; isAdmin: boolean }) {
  const [params] = useSearchParams();
  const linked = Number(params.get('job')) || null;
  const [openJob, setOpenJob] = useState<number | null>(linked);
  const [show, setShow] = useState<Show>('all');

  const jobs = useQuery({
    queryKey: qk.deviceJobs(deviceId),
    queryFn: ({ signal }) => api.deviceJobs(deviceId, signal).then((r) => r.jobs),
    refetchInterval: 10_000,
  });
  const alerts = useQuery({
    queryKey: qk.deviceAlerts(deviceId),
    queryFn: ({ signal }) => api.deviceAlerts(deviceId, signal),
  });
  const audit = useQuery({
    queryKey: qk.deviceAudit(deviceId),
    queryFn: ({ signal }) => api.audit({ deviceId, limit: 200 }, signal).then((r) => r.events),
    enabled: isAdmin,
  });
  const auditDenied = audit.error instanceof ApiError && audit.error.status === 403;

  const entries = useMemo(
    () => buildTimeline(jobs.data ?? [], alerts.data?.alerts ?? [], audit.data ?? []),
    [jobs.data, alerts.data, audit.data],
  );
  const filtered = show === 'all' ? entries : entries.filter((e) => e.kind === show);
  const groups = byDay(filtered, auditDayLabel);

  // Bring a linked job into view once it is on the page.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!linked || scrolled.current || !jobs.data) return;
    scrolled.current = true;
    document.getElementById(`job-${linked}`)?.scrollIntoView({ block: 'start' });
  }, [linked, jobs.data]);

  const options = [
    { id: 'all' as Show, label: 'Alles' },
    { id: 'job' as Show, label: 'Aufträge', count: entries.filter((e) => e.kind === 'job').length },
    { id: 'alert' as Show, label: 'Alarme', count: entries.filter((e) => e.kind === 'alert').length },
    ...(isAdmin && !auditDenied ? [{ id: 'change' as Show, label: 'Änderungen', count: entries.filter((e) => e.kind === 'change').length }] : []),
  ];
  const error = jobs.error ?? alerts.error ?? (auditDenied ? null : audit.error);

  return (
    <Panel
      title="Aktivität"
      meta="Aufträge, Alarme und Änderungen — neueste zuerst"
      actions={<FilterBar options={options} value={show} onChange={setShow} label="Aktivität filtern" />}
      padded={false}
    >
      {error && (
        <div className="dv-pad">
          <ErrorNote error={error} onRetry={() => void Promise.all([jobs.refetch(), alerts.refetch()])} />
        </div>
      )}
      {jobs.isPending || alerts.isPending ? (
        <div className="dv-pad">
          <SkeletonRows rows={4} />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<IconHistory size={22} />} title="Noch nichts passiert">
          Aufträge, Alarme und Änderungen an diesem Gerät erscheinen hier.
        </EmptyState>
      ) : (
        <div className="tl">
          {groups.map((g) => (
            <section key={g.day} className="tl-day" aria-label={g.day}>
              <h3 className="tl-day-label">{g.day}</h3>
              <ol>
                {g.entries.map((e) => (
                  <Entry
                    key={e.key}
                    e={e}
                    open={e.kind === 'job' && openJob === e.job.id}
                    onToggle={() => e.kind === 'job' && setOpenJob((o) => (o === e.job.id ? null : e.job.id))}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
