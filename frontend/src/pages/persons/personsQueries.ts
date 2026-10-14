/** Data the persons page loads beyond the fleet props. */
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { useCachedQueryState } from '../../hooks/useCachedQueryState';
import { firstLoadError } from '../../hooks/useFleet';

export const ACCOUNTS_KEY = ['accounts'] as const;
/** The newest slice of the audit log; each person's activity is filtered
 *  out of it, so switching persons costs no request. */
export const RECENT_AUDIT_KEY = ['audit', 'recent'] as const;
const AUDIT_SLICE = 200;

/** Accounts and the audit log are admin-only; for anyone else the queries
 *  never run, rather than failing with a 403 nobody asked for. */
export function useAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: ({ signal }) => api.accounts(signal).then((r) => r.accounts),
    enabled,
  });
}

export function useRecentAudit(enabled: boolean) {
  return useQuery({
    queryKey: RECENT_AUDIT_KEY,
    queryFn: ({ signal }) => api.audit({ limit: AUDIT_SLICE }, signal).then((r) => r.events),
    enabled,
  });
}

/**
 * Where the fleet's persons list stands. The page gets the list as a prop
 * without a status, and an empty array would otherwise read as "no persons
 * yet" while the first load runs or after it failed. Once a list has
 * arrived, a failed refresh keeps showing it.
 */
export function usePersonsLoad(): { loading: boolean; error: unknown } {
  const fetching = useIsFetching({ queryKey: qk.persons });
  // Subscribes to the cache entry, so the page renders again when it fails.
  const state = useCachedQueryState(qk.persons);
  return {
    loading: fetching > 0 && state?.status === 'pending',
    error: firstLoadError(state),
  };
}
