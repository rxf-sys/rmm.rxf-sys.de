import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { qk } from '../../api/queryClient';

export interface FleetLoad {
  /** The device list or the patch summary is still on its first load. */
  loading: boolean;
  /** The device list failed before it ever arrived; null otherwise. */
  error: unknown;
}

function readLoading(qc: QueryClient): boolean {
  return qc.getQueryState(qk.devices)?.status === 'pending' || qc.getQueryState(qk.patchSummary)?.status === 'pending';
}

function readError(qc: QueryClient): unknown {
  // Once a list has arrived, a failed refresh keeps showing it; the shell's
  // connection banner says that the data is getting old.
  const s = qc.getQueryState(qk.devices);
  return s?.status === 'error' && s.data === undefined ? s.error : null;
}

/**
 * Where the fleet data behind the page stands.
 *
 * The page gets the devices and the summary as props, and an empty array
 * looks the same whether nothing has arrived yet, the request failed or the
 * fleet is empty. The shared query cache knows the difference. A query that
 * is not in the cache (a test that passes props only) counts as loaded: the
 * props are then all there is.
 */
export function useFleetLoad(): FleetLoad {
  const qc = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => qc.getQueryCache().subscribe(onChange), [qc]);
  const loading = useSyncExternalStore(
    subscribe,
    () => readLoading(qc),
    () => readLoading(qc),
  );
  const error = useSyncExternalStore(
    subscribe,
    () => readError(qc),
    () => readError(qc),
  );
  return { loading, error };
}
