import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

/**
 * One cache for the whole dashboard. Screens that need the same data (the
 * device list, the sidebar badges, the command palette) share one request
 * instead of each polling on its own.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        // Nothing polls while the tab is hidden; a phone in a pocket has no reader.
        refetchIntervalInBackground: false,
        // A 4xx will not get better by asking again; network and 5xx might.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

/** Query keys. Everything under 'fleet' is refreshed by fleet socket hints. */
export const qk = {
  fleet: ['fleet'] as const,
  devices: ['fleet', 'devices'] as const,
  alerts: ['fleet', 'alerts'] as const,
  patchSummary: ['fleet', 'patch-summary'] as const,
  persons: ['fleet', 'persons'] as const,
  device: (id: number) => ['device', id] as const,
  deviceAll: ['device'] as const,
  scripts: ['scripts'] as const,
};
