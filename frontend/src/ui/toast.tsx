/**
 * Toasts and the session's job results.
 *
 * `notify` wraps Sonner so every screen says things the same way. `trackJob`
 * turns a started job into one toast that follows it to the end — "läuft" →
 * "abgeschlossen" or "fehlgeschlagen" — with a link to the output, and
 * records the result for the notification centre.
 */
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '../api/client';
import type { Job } from '../types';

let navigate: ((path: string) => void) | null = null;
/** The app hands in its router so toast actions can open pages. */
export function setToastNavigator(fn: ((path: string) => void) | null): void {
  navigate = fn;
}

export const notify = {
  success: (title: string, description?: string) => toast.success(title, { description }),
  info: (title: string, description?: string) => toast(title, { description }),
  warning: (title: string, description?: string) => toast.warning(title, { description }),
  error: (title: string, error?: unknown) =>
    toast.error(title, { description: error === undefined ? undefined : apiErrorMessage(error), duration: 8000 }),
};

// ---- Job results of this session ------------------------------------------

export interface JobResult {
  jobId: number;
  deviceId: number;
  deviceName: string;
  label: string;
  status: Job['status'];
  exitCode: number | null;
  finishedAt: number;
}

const MAX_RESULTS = 20;
let results: JobResult[] = [];
const listeners = new Set<() => void>();

function pushResult(r: JobResult): void {
  results = [r, ...results.filter((x) => x.jobId !== r.jobId)].slice(0, MAX_RESULTS);
  listeners.forEach((l) => l());
}

/** Finished jobs started from this browser tab, newest first. */
export function useJobResults(): JobResult[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => results,
    () => results,
  );
}

const TERMINAL = new Set<Job['status']>(['done', 'failed', 'timeout']);
const POLL_MS = 2_000;
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;

function jobPath(deviceId: number, jobId: number): string {
  return `/devices/${deviceId}?tab=jobs&job=${jobId}`;
}

/**
 * Follow a job to its end with one toast. Polls the job (the live output
 * socket belongs to the device page); stops after two hours, the longest a
 * patch run may take.
 */
export function trackJob(job: Job, opts: { deviceName: string; label: string }): void {
  const id = `job-${job.id}`;
  const open = { label: 'Ausgabe', onClick: () => navigate?.(jobPath(job.device_id, job.id)) };
  toast.loading(`${opts.label} läuft`, { id, description: opts.deviceName, duration: Infinity, action: open });
  const started = Date.now();

  const finish = (j: Job) => {
    pushResult({
      jobId: j.id,
      deviceId: j.device_id,
      deviceName: opts.deviceName,
      label: opts.label,
      status: j.status,
      exitCode: j.exit_code,
      finishedAt: Math.floor(Date.now() / 1000),
    });
    const detail = `${opts.deviceName}${j.exit_code !== null ? ` · Exit ${j.exit_code}` : ''}`;
    if (j.status === 'done') toast.success(`${opts.label} abgeschlossen`, { id, description: detail, duration: 6000, action: open });
    else if (j.status === 'timeout')
      toast.error(`${opts.label}: Zeitüberschreitung`, { id, description: opts.deviceName, duration: 10000, action: open });
    else toast.error(`${opts.label} fehlgeschlagen`, { id, description: detail, duration: 10000, action: open });
  };

  const poll = () => {
    api
      .job(job.id)
      .then(({ job: j }) => {
        if (TERMINAL.has(j.status)) finish(j);
        else if (Date.now() - started < MAX_WAIT_MS) setTimeout(poll, POLL_MS);
        else toast.dismiss(id);
      })
      .catch(() => {
        // A failed poll is not a failed job; try again a little later.
        if (Date.now() - started < MAX_WAIT_MS) setTimeout(poll, POLL_MS * 3);
      });
  };
  setTimeout(poll, POLL_MS);
}
