import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage, openFleetSocket } from '../api/client';
import type { Alert, Device, PatchSummary, Person } from '../types';

export interface Fleet {
  devices: Device[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  persons: Person[];
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
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    return Promise.all([
      api.devices(signal),
      api.alerts(signal),
      api.patchSummary(signal).catch(() => ({ summary: {} as PatchSummary })),
      api.persons(signal).catch(() => ({ persons: [] as Person[] })),
    ])
      .then(([d, a, p, pe]) => {
        setDevices(d.devices);
        setAlerts(a.alerts);
        setPatchSummary(p.summary);
        setPersons(pe.persons);
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

  // Live fleet events (device online/offline, alert, patches) trigger an
  // immediate refetch; the interval is the fallback when the socket is down.
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = setInterval(() => void load(ctrl.signal), REFRESH_MS);

    let closed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = openFleetSocket();
      } catch {
        return;
      }
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'refresh') {
            // Coalesce bursts (e.g. many agents reconnecting after a restart).
            clearTimeout(debounce);
            debounce = setTimeout(() => void load(), 300);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (!closed) setTimeout(connect, 5000); // reconnect with a small delay
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(debounce);
      wsRef.current?.close();
      ctrl.abort();
    };
  }, [load]);

  return { devices, alerts, patchSummary, persons, loading, error, refresh: () => void load() };
}
