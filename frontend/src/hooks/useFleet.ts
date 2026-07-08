import { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import type { Alert, Device, PatchSummary } from '../types';

export interface Fleet {
  devices: Device[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const REFRESH_MS = 30_000;

/**
 * Polls the fleet-wide snapshot (devices + alerts + patch summary) used by the
 * app shell (sidebar badges, command palette, favorites) and the overview /
 * patches pages. One shared poller keeps those in sync without each surface
 * fetching devices separately.
 */
export function useFleet(): Fleet {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [patchSummary, setPatchSummary] = useState<PatchSummary>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return Promise.all([
      api.devices(signal),
      api.alerts(signal),
      api.patchSummary(signal).catch(() => ({ summary: {} as PatchSummary })),
    ])
      .then(([d, a, p]) => {
        setDevices(d.devices);
        setAlerts(a.alerts);
        setPatchSummary(p.summary);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!signal?.aborted) {
          setError(apiErrorMessage(e));
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => void load(ctrl.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [load]);

  return { devices, alerts, patchSummary, loading, error, refresh: () => void load() };
}
