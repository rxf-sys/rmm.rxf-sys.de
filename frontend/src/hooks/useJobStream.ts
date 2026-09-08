import { useEffect, useRef, useState } from 'react';
import { openJobSocket } from '../api/client';
import type { JobStatus } from '../types';

export interface JobStreamState {
  output: string;
  status: JobStatus | null;
  exitCode: number | null;
  /** False while a dropped socket is being retried, so the UI can say so. */
  connected: boolean;
}

const EMPTY: JobStreamState = { output: '', status: null, exitCode: null, connected: false };

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

const isTerminal = (s: JobStatus | null) => s === 'done' || s === 'failed' || s === 'timeout';

/**
 * Streams one job's output over a WebSocket. Works for both live and finished
 * jobs: the server always sends a snapshot (status + stored output) first,
 * then — if still running — streams output/status/done events. Pass null to
 * detach. Re-runs whenever jobId changes, so clicking a past job replays its
 * stored output through the same path.
 *
 * A dropped socket is retried with backoff as long as the job has not reached a
 * terminal status. Without that, a brief network hiccup left the panel frozen
 * on a half-finished job with no indication that it had stopped updating —
 * exactly when someone is watching a patch run.
 */
export function useJobStream(jobId: number | null): JobStreamState {
  const [state, setState] = useState<JobStreamState>(EMPTY);
  // Reset during render when the prop changes, rather than in an effect: an
  // effect would render the previous job's output once before clearing it.
  const [seenJobId, setSeenJobId] = useState<number | null>(jobId);
  if (jobId !== seenJobId) {
    setSeenJobId(jobId);
    setState(EMPTY);
  }

  // Mirrored into a ref so the socket's onclose handler can read the current
  // status without being re-created on every output chunk.
  const statusRef = useRef<JobStatus | null>(null);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    if (jobId === null) return;

    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = RECONNECT_MIN_MS;

    const connect = () => {
      if (closed) return;
      ws = openJobSocket(jobId);

      ws.onopen = () => {
        delay = RECONNECT_MIN_MS;
        setState((s) => ({ ...s, connected: true }));
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as {
          type: string;
          job?: { output?: string; status?: JobStatus; exit_code?: number | null };
          status?: JobStatus;
          chunk?: string;
          exit_code?: number | null;
        };
        if (msg.type === 'snapshot' && msg.job) {
          // A reconnect replays the full stored output, so replacing rather
          // than appending is what keeps the panel free of duplicates.
          setState({
            output: msg.job.output ?? '',
            status: msg.job.status ?? null,
            exitCode: msg.job.exit_code ?? null,
            connected: true,
          });
        } else if (msg.type === 'status' && msg.status) {
          setState((s) => ({ ...s, status: msg.status! }));
        } else if (msg.type === 'output' && typeof msg.chunk === 'string') {
          setState((s) => ({ ...s, output: s.output + msg.chunk }));
        } else if (msg.type === 'done') {
          setState((s) => ({
            ...s,
            status: msg.status ?? s.status,
            exitCode: msg.exit_code ?? null,
            connected: true,
          }));
          closed = true;
          ws?.close();
        }
        // 'ping' keepalives are ignored.
      };

      ws.onclose = () => {
        if (closed || isTerminal(statusRef.current)) return;
        setState((s) => ({ ...s, connected: false }));
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      };

      // onerror is always followed by onclose; funnel both through one path.
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      ws?.close();
    };
  }, [jobId]);

  return state;
}
