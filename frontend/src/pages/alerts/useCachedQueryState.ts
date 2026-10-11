import { useQueryClient, type QueryKey, type QueryState } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The cache entry of a query this page reads but does not fetch. The fleet
 * hook loads the alerts and the shell hands them down as props, and props
 * cannot tell "nothing is open" from "nothing has arrived yet". The cache
 * can, without a request of its own. `undefined` while nothing has
 * registered the query.
 */
export function useCachedQueryState<T>(key: QueryKey): QueryState<T> | undefined {
  const qc = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => qc.getQueryCache().subscribe(onChange), [qc]);
  // A query's state object is replaced on every change and kept otherwise,
  // so it is a stable snapshot by itself.
  const read = () => qc.getQueryState<T>(key);
  return useSyncExternalStore(subscribe, read, read);
}
