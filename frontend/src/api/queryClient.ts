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
  // The one persons list: the fleet, the persons page and the person pickers
  // of the device dialogs all read it, so a person created or deleted on one
  // screen is at once on or off the others.
  persons: ['fleet', 'persons'] as const,
  device: (id: number) => ['device', id] as const,
  deviceAll: ['device'] as const,
  // Under the device's own key, so refreshing a device refreshes its tabs.
  devicePatches: (id: number) => ['device', id, 'patches'] as const,
  deviceJobs: (id: number) => ['device', id, 'jobs'] as const,
  deviceAlerts: (id: number) => ['device', id, 'alerts'] as const,
  deviceHistory: (id: number, hours: number) => ['device', id, 'history', hours] as const,
  deviceAudit: (id: number) => ['device', id, 'audit'] as const,
  deviceMdm: (id: number) => ['device', id, 'mdm'] as const,
  mdmConfigs: ['mdm-configs'] as const,
  deviceActions: (id: number) => ['device', id, 'actions'] as const,
  scripts: ['scripts'] as const,
  // GET /api/accounts, read by the admin page and the persons page. One key,
  // so an account change on either page shows on the other: the persons page
  // words its delete confirmation from the cached role, and the server
  // deletes a person's viewer account with the person.
  accounts: ['accounts'] as const,
};
