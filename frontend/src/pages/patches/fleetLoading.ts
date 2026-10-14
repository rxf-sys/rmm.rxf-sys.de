import { qk } from '../../api/queryClient';
import { useCachedQueryState } from '../../hooks/useCachedQueryState';

export interface FleetLoad {
  /** The device list or the patch summary is still on its first load. */
  loading: boolean;
  /** The device list or the patch summary failed before it ever arrived;
   *  null otherwise. Without the summary every device would count as up to
   *  date, so the page has nothing honest to show. */
  error: unknown;
}

/** The error of a query that failed before any data arrived. */
function firstLoadError(state: { status: string; data: unknown; error: unknown } | undefined): unknown {
  return state?.status === 'error' && state.data === undefined ? state.error : null;
}

/**
 * Where the fleet data behind the page stands.
 *
 * The page gets the devices and the summary as props, and an empty array
 * looks the same whether nothing has arrived yet, the request failed or the
 * fleet is empty. A query that is not in the cache (a test that passes props
 * only) counts as loaded: the props are then all there is.
 */
export function useFleetLoad(): FleetLoad {
  const devices = useCachedQueryState(qk.devices);
  const summary = useCachedQueryState(qk.patchSummary);
  return {
    loading: devices?.status === 'pending' || summary?.status === 'pending',
    // Once data has arrived, a failed refresh keeps showing it; the shell's
    // connection banner says that the data is getting old.
    error: firstLoadError(devices) ?? firstLoadError(summary),
  };
}
