import type { JobStatus } from '../../types';

/** A job's status in words. */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'wartet',
  running: 'läuft',
  done: 'fertig',
  failed: 'fehlgeschlagen',
  timeout: 'Zeitüberschreitung',
};
