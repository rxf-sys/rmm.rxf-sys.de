import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { api, apiErrorMessage, openFleetSocket } from '../api/client';
import { qk } from '../api/queryClient';
import type { Alert, Device, PatchSummary, Person } from '../types';

export interface Fleet {
  devices: Device[];
  alerts: Alert[];
  /** How many resolved alerts the server listed when it left older ones
   *  out; null when the history is complete. Open and acknowledged alerts
   *  always arrive in full. */
  resolvedAlertsCap: number | null;
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
// Floor between two refreshes triggered by socket hints. An alert storm (a
// site losing its uplink takes hundreds of devices offline at once) used to
// turn every single `alert.fired` into a full refetch of the device list.
export const MIN_REFRESH_GAP_MS = 2_000;

export interface RefreshScheduler {
  /** Ask for a load. Throttled to one start per `minGapMs`; `immediate`
   *  skips the throttle. A request while a load is in flight queues exactly
   *  one follow-up load. */
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
 * The fleet socket carries no data, only `{"type":"refresh"}` hints. Each
 * hint marks the fleet queries (and an open device page) stale; the throttle
 * keeps a burst of hints to one refetch per gap.
 */
function useFleetSocket(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const scheduler = createRefreshScheduler(async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.fleet }),
        qc.invalidateQueries({ queryKey: qk.deviceAll }),
      ]);
    }, MIN_REFRESH_GAP_MS);

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
      scheduler.cancel();
      clearTimeout(retry);
      ws?.close();
    };
  }, [enabled, qc]);
}

/** The alert list as the fleet query caches it. */
export interface AlertList {
  alerts: Alert[];
  resolvedCap: number | null;
}

const EMPTY_DEVICES: Device[] = [];
const EMPTY_ALERTS: Alert[] = [];
const EMPTY_SUMMARY: PatchSummary = {};
const EMPTY_PERSONS: Person[] = [];

/**
 * The fleet-wide snapshot behind the shell (sidebar badges, command palette,
 * favourites) and the overview, device and patch screens. Nothing is fetched
 * before `enabled` (a session exists): requests made before login only
 * collected 401s.
 */
export function useFleet(enabled: boolean): Fleet {
  const qc = useQueryClient();
  const common = { enabled, refetchInterval: REFRESH_MS } as const;

  const devices = useQuery({
    ...common,
    queryKey: qk.devices,
    queryFn: ({ signal }) => api.devices(signal).then((r) => r.devices),
  });
  const alerts = useQuery({
    ...common,
    queryKey: qk.alerts,
    queryFn: ({ signal }): Promise<AlertList> =>
      api.alerts(signal).then((r) => ({ alerts: r.alerts, resolvedCap: r.resolved_truncated ? r.resolved_limit : null })),
  });
  // A failure here is an error like any other, not an empty answer: an
  // empty summary reads as "every device up to date" and an empty persons
  // list as "nobody yet". As errors, a failed refresh keeps the last good
  // data and is retried, and the pages that need them tell "failed" from
  // "empty" through the cache (fleetLoading.ts, personsQueries.ts). The
  // shell's badges and pickers fall back to empty until something arrives.
  const patchSummary = useQuery({
    ...common,
    queryKey: qk.patchSummary,
    queryFn: ({ signal }) => api.patchSummary(signal).then((r) => r.summary),
  });
  const persons = useQuery({
    ...common,
    queryKey: qk.persons,
    queryFn: ({ signal }) => api.persons(signal).then((r) => r.persons),
  });

  useFleetSocket(enabled);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.fleet });
  }, [qc]);

  const failed = devices.error ?? alerts.error;
  const updated = Math.max(devices.dataUpdatedAt, alerts.dataUpdatedAt);

  return {
    devices: devices.data ?? EMPTY_DEVICES,
    alerts: alerts.data?.alerts ?? EMPTY_ALERTS,
    resolvedAlertsCap: alerts.data?.resolvedCap ?? null,
    patchSummary: patchSummary.data ?? EMPTY_SUMMARY,
    persons: persons.data ?? EMPTY_PERSONS,
    loading: enabled && (devices.isPending || alerts.isPending),
    error: failed ? apiErrorMessage(failed) : null,
    loadedAt: updated > 0 ? Math.floor(updated / 1000) : null,
    refresh,
  };
}
