import { useEffect, useState } from 'react';
import { openJobSocket } from '../api/client';
import type { JobStatus } from '../types';

export interface JobStreamState {
  output: string;
  status: JobStatus | null;
  exitCode: number | null;
}

/**
 * Streams one job's output over a WebSocket. Works for both live and finished
 * jobs: the server always sends a snapshot (status + stored output) first,
 * then — if still running — streams output/status/done events. Pass null to
 * detach. Re-runs whenever jobId changes, so clicking a past job replays its
 * stored output through the same path.
 */
export function useJobStream(jobId: number | null): JobStreamState {
  const [state, setState] = useState<JobStreamState>({
    output: '',
    status: null,
    exitCode: null,
  });

  useEffect(() => {
    if (jobId === null) {
      setState({ output: '', status: null, exitCode: null });
      return;
    }
    setState({ output: '', status: null, exitCode: null });
    const ws = openJobSocket(jobId);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {
        type: string;
        job?: { output?: string; status?: JobStatus; exit_code?: number | null };
        status?: JobStatus;
        chunk?: string;
        exit_code?: number | null;
      };
      if (msg.type === 'snapshot' && msg.job) {
        setState({
          output: msg.job.output ?? '',
          status: msg.job.status ?? null,
          exitCode: msg.job.exit_code ?? null,
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
        }));
        ws.close();
      }
      // 'ping' keepalives are ignored.
    };
    return () => ws.close();
  }, [jobId]);

  return state;
}
