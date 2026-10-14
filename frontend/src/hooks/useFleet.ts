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
  /** Sekunden seit Epoch der letzten erfolgreichen Abfrage, sonst null.
   *  Fällt der Server aus, sagt die Oberfläche damit, wie alt das ist, was
   *  sie gerade zeigt — vorher blieben die alten Zahlen kommentarlos stehen. */
  loadedAt: number | null;
  refresh: () => void;
}

const REFRESH_MS = 30_000;
// Reconnect backoff for the fleet socket. A fixed 5 s meant that a backend
// that stays down has every open tab knocking twelve times a minute, forever.
const WS_RETRY_MIN_MS = 2_000;
const WS_RETRY_MAX_MS = 60_000;
// Floor between two fleet loads triggered by socket hints. An alert storm
// (a site losing its uplink takes hundreds of devices offline at once) used
// to turn every single `alert.fired` into a full refetch of the device list.
export const MIN_REFRESH_GAP_MS = 2_000;

export interface RefreshScheduler {
  /** Ask for a load. Throttled to one start per `minGapMs`; `immediate`
   *  skips the throttle (an explicit user or login refresh). A request while
   *  a load is in flight queues exactly one follow-up load. */
  request: (opts?: { immediate?: boolean }) => void;
  cancel: () => void;
}

/** One load at a time, at most one queued, at most one start per gap. */
export function createRefreshScheduler(load: () => Promise<void>, minGapMs: number): RefreshScheduler {
  let inFlight = false;
  let queued = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const run = () => {
    if (cancelled) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    lastStart = Date.now();
    void load().finally(() => {
      inFlight = false;
      if (queued) {
        queued = false;
        request();
      }
    });
  };

  const request = (opts?: { immediate?: boolean }) => {
    if (cancelled) return;
    if (opts?.immediate) {
      clearTimeout(timer);
      timer = undefined;
      run();
      return;
    }
    if (timer !== undefined) return;
    const wait = Math.max(0, lastStart + minGapMs - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, wait);
  };

  return {
    request,
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

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
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback((signal: AbortSignal): Promise<void> => {
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
        setLoadedAt(Math.floor(Date.now() / 1000));
        setLoading(false);
      })
      .catch((e) => {
        if (!signal.aborted) {
          setError(apiErrorMessage(e));
          setLoading(false);
        }
      });
  }, []);

  // Live fleet events (device online/offline, alert, patches) trigger a
  // throttled refetch; the interval is the fallback when the socket is down.
  // Nothing polls while the tab is hidden — a phone in a pocket has no reader.
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const scheduler = createRefreshScheduler(() => load(ctrl.signal), MIN_REFRESH_GAP_MS);
    schedulerRef.current = scheduler;
    scheduler.request({ immediate: true });
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') scheduler.request();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduler.request();
    };
    document.addEventListener('visibilitychange', onVisible);

    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = WS_RETRY_MIN_MS;
    let ws: WebSocket | null = null;
    const connect = () => {
      if (closed) return;
      let sock: WebSocket;
      try {
        sock = openFleetSocket();
      } catch {
        // Constructing the socket threw (bad URL, blocked scheme). Retrying
        // on the same schedule beats giving up silently for the tab's life.
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, WS_RETRY_MAX_MS);
        return;
      }
      ws = sock;
      sock.onopen = () => {
        delay = WS_RETRY_MIN_MS;
      };
      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'refresh') scheduler.request();
        } catch {
          // A frame that is not JSON carries no hint; the poll still runs.
        }
      };
      sock.onclose = () => {
        ws = null;
        if (closed) return;
        retry = setTimeout(connect, delay);
        // Jitter-free is fine here: one browser tab, not a fleet of agents.
        delay = Math.min(delay * 2, WS_RETRY_MAX_MS);
      };
      sock.onerror = () => sock.close();
    };
    connect();

    return () => {
      closed = true;
      schedulerRef.current = null;
      scheduler.cancel();
      clearInterval(timer);
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
      ctrl.abort();
    };
  }, [load]);

  // Stable identity: App re-runs an effect whenever this changes, and a fresh
  // closure per render turned that effect into an endless refetch loop.
  const refresh = useCallback(() => schedulerRef.current?.request({ immediate: true }), []);

  return {
    devices,
    alerts,
    patchSummary,
    persons,
    loading,
    error,
    loadedAt,
    refresh,
  };
}
