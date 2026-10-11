/** Data the persons page loads beyond the fleet props. */
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';

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
 * Is the fleet's persons list still on its first load? The page gets the
 * list as a prop without a loading flag, and an empty array would otherwise
 * read as "no persons yet". `useIsFetching` subscribes, so the page renders
 * again when the load ends.
 */
export function useFirstPersonsLoad(): boolean {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: qk.persons });
  return fetching > 0 && qc.getQueryState(qk.persons)?.status === 'pending';
}
