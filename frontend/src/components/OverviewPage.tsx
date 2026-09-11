import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { AUDIT_CATEGORY, auditNamesFrom, describeAudit } from '../auditText';
import { deviceState } from '../deviceStatus';
import { formatRelative } from '../format';
import type { Fleet } from '../hooks/useFleet';
import { buildTasks, verdict, type OverviewTask, type TaskTarget } from '../overviewTasks';
import type { Account, AuditEvent, FleetSample } from '../types';
import { Skeleton } from '../ui';
import type { PageId } from './Sidebar';

interface Props {
  fleet: Fleet;
  user: Account;
  onOpenDevice: (id: number) => void;
  /** `query` hängt die Filter-Parameter an (z. B. `filter=offline`). */
  onNavigate: (p: PageId, query?: string) => void;
  onOpenEnroll: () => void;
  canEnroll: boolean;
}

/** Wie viele Aufgaben höchstens angezeigt werden — der Rest steht als Zahl in
 *  der Überschrift, damit die Seite nicht auf eine Scroll-Liste hinausläuft. */
const MAX_TASKS = 6;
const CHART_HOURS = 24;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function hhmm(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

const SEVERITY_COLOR = {
  crit: 'var(--dangerS)',
  warn: 'var(--warn)',
  info: 'var(--tx3)',
  ok: 'var(--ok)',
} as const;

// ---------------------------------------------------------------------------
// Aufgabenliste
// ---------------------------------------------------------------------------

function TaskRow({ task, onGo }: { task: OverviewTask; onGo: (t: TaskTarget) => void }) {
  return (
    <button className="ov-task" type="button" onClick={() => onGo(task.target)}>
      <span className="ov-rail" style={{ background: SEVERITY_COLOR[task.severity] }} />
      <span className={`ov-sev ov-sev-${task.severity}`}>{task.tag}</span>
      <span className="ov-task-body">
        <span className="ov-task-title">{task.title}</span>
        <span className="ov-task-why">{task.why}</span>
      </span>
      <span className="ov-go">{task.actionLabel}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Flottenlast, letzte 24 Stunden
// ---------------------------------------------------------------------------

/**
 * Ein Flächendiagramm über die Stundenmittel der ganzen Flotte.
 *
 * Vorher stand hier eine Polylinie über die *aktuelle* CPU je Gerät — ein
 * Balkendiagramm ohne Achse, dessen x-Achse die Gerätereihenfolge war. Das
 * sah aus wie ein Verlauf und war keiner.
 */
function LoadChart({ samples }: { samples: FleetSample[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const W = 600;
  const H = 150;
  const PAD_B = 18;

  if (samples.length < 2) {
    return (
      <p className="muted" style={{ margin: '18px 0', fontSize: 12 }}>
        Noch zu wenige Messpunkte — die Kurve entsteht aus den Heartbeats der letzten{' '}
        {CHART_HOURS} Stunden.
      </p>
    );
  }

  const x = (i: number) => (i / (samples.length - 1)) * W;
  const y = (v: number) => (H - PAD_B) - (v / 100) * (H - PAD_B);
  const line = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.cpu_avg).toFixed(1)}`).join(' ');
  const area = `${x(0)},${H - PAD_B} ${line} ${x(samples.length - 1)},${H - PAD_B}`;
  const peak = samples.reduce((a, s) => (s.cpu_avg > a.cpu_avg ? s : a), samples[0] as FleetSample);
  const active = hover === null ? null : samples[hover];

  const pick = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    setHover(Math.round(ratio * (samples.length - 1)));
  };

  return (
    <div className="ov-chart" ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`Durchschnittliche CPU-Last der Flotte über ${CHART_HOURS} Stunden, Höchstwert ${Math.round(peak.cpu_avg)} Prozent`}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ov-load" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} stroke="var(--line2)" strokeWidth="1" />
        ))}
        <polygon points={area} fill="url(#ov-load)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active && (
          <>
            <line
              x1={x(hover ?? 0)}
              x2={x(hover ?? 0)}
              y1="0"
              y2={H - PAD_B}
              stroke="var(--accLine)"
              strokeWidth="1"
            />
            <circle cx={x(hover ?? 0)} cy={y(active.cpu_avg)} r="3.5" fill="var(--accent)" />
          </>
        )}
        <text className="ov-tick" x="0" y={H - 4}>
          {hhmm(samples[0]!.ts)}
        </text>
        <text className="ov-tick" x={W} y={H - 4} textAnchor="end">
          {hhmm(samples[samples.length - 1]!.ts)}
        </text>
      </svg>
      {active && (
        <div
          className="ov-tip"
          style={{ left: `${((hover ?? 0) / (samples.length - 1)) * 100}%`, opacity: 1 }}
        >
          <b>{Math.round(active.cpu_avg)} %</b> um {hhmm(active.ts)} · {active.devices} Gerät
          {active.devices === 1 ? '' : 'e'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OverviewPage({
  fleet,
  user,
  onOpenDevice,
  onNavigate,
  onOpenEnroll,
  canEnroll,
}: Props) {
  const { devices, alerts, patchSummary, loading } = fleet;
  const [activity, setActivity] = useState<AuditEvent[] | null>(null);
  const [samples, setSamples] = useState<FleetSample[]>([]);
  // Die Aufgaben rechnen mit „jetzt" („seit 3 Tagen offline"), also muss die
  // Uhr laufen — sonst altert die Seite still, solange der Tab offen bleibt.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Aktivität ist Admin-Sache (Audit-Endpunkt); für alle anderen bleibt die
    // Karte leer statt eine Fehlermeldung zu zeigen.
    const ctrl = new AbortController();
    api
      .audit({ limit: 6 }, ctrl.signal)
      .then((r) => setActivity(r.events))
      .catch(() => setActivity([]));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .fleetMetrics(CHART_HOURS, ctrl.signal)
      .then((r) => setSamples(r.samples))
      .catch(() => setSamples([]));
    return () => ctrl.abort();
  }, []);

  const names = useMemo(() => auditNamesFrom(devices), [devices]);
  const tasks = useMemo(
    () => buildTasks({ devices, patchSummary, now }),
    [devices, patchSummary, now],
  );
  const head = verdict(devices, tasks);

  const online = devices.filter((d) => d.online).length;
  const pending = Object.values(patchSummary).reduce((a, s) => a + s.pending, 0);
  const security = Object.values(patchSummary).reduce((a, s) => a + s.security, 0);
  const patchedDevices = Object.values(patchSummary).filter((s) => s.pending > 0).length;
  const securityDevices = Object.values(patchSummary).filter((s) => s.security > 0).length;
  const openAlerts = alerts.filter((a) => a.resolved_at === null);
  const ackedAlerts = openAlerts.filter((a) => a.acked_at !== null).length;

  const buckets = useMemo(() => {
    const counts = { ok: 0, warn: 0, crit: 0, off: 0 };
    for (const d of devices) counts[deviceState(d)] += 1;
    return counts;
  }, [devices]);

  const go = (t: TaskTarget) =>
    t.kind === 'device' ? onOpenDevice(t.id) : onNavigate(t.page, t.query);

  if (loading && devices.length === 0) {
    return (
      <div className="screen">
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="ov-head">
        <h1 className="page-title">
          {greeting()}, {user.username}
        </h1>
        <span className="muted">
          {new Date().toLocaleDateString('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          {devices.length > 0 && ` · ${online} von ${devices.length} Geräten melden sich planmäßig`}
        </span>
        <div className="ov-verdict">
          <span className="ov-pip" style={{ background: SEVERITY_COLOR[head.severity] }} />
          <span>{head.text}</span>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="empty">
          <h2>Noch keine Geräte</h2>
          <p className="muted">
            Installiere den Agenten auf deinem ersten Gerät, um Monitoring zu starten.
          </p>
          {canEnroll && (
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={onOpenEnroll}>
              + Gerät hinzufügen
            </button>
          )}
        </div>
      ) : (
        <section className="card ov-tasks" aria-labelledby="ov-tasks-h">
          <div className="ov-tasks-head">
            <h2 id="ov-tasks-h">Zu tun</h2>
            <span className="ov-count">
              {tasks.length === 0
                ? 'nichts offen'
                : `${tasks.length} Punkt${tasks.length === 1 ? '' : 'e'}`}
            </span>
          </div>
          {tasks.length === 0 ? (
            <div className="ov-nothing">
              <span style={{ color: 'var(--ok)', fontSize: 18 }}>✓</span>
              <span>
                Keine offenen Befunde. Platten unter 80 %, keine Sicherheitsupdates offen, alle
                Geräte erreichbar.
              </span>
            </div>
          ) : (
            tasks.slice(0, MAX_TASKS).map((t) => <TaskRow key={t.id} task={t} onGo={go} />)
          )}
        </section>
      )}

      <div className="ov-kpis">
        <button className="ov-kpi" type="button" onClick={() => onNavigate('devices')}>
          <span className="ov-k">Online</span>
          <span className="ov-v">
            {online}
            <span style={{ color: 'var(--tx3)', fontSize: 15 }}>/{devices.length}</span>
          </span>
          <span className="ov-n">{devices.length - online} offline</span>
        </button>
        <button className="ov-kpi" type="button" onClick={() => onNavigate('patches')}>
          <span className="ov-k">Updates offen</span>
          <span className="ov-v" style={{ color: pending ? 'var(--warn)' : undefined }}>
            {pending}
          </span>
          <span className="ov-n">auf {patchedDevices} Geräten</span>
        </button>
        <button className="ov-kpi" type="button" onClick={() => onNavigate('patches')}>
          <span className="ov-k">Sicherheit</span>
          <span className="ov-v" style={{ color: security ? 'var(--dangerS)' : 'var(--ok)' }}>
            {security}
          </span>
          <span className="ov-n">
            {security === 0 ? 'nichts offen' : `auf ${securityDevices} Geräten`}
          </span>
        </button>
        <button className="ov-kpi" type="button" onClick={() => onNavigate('alerts')}>
          <span className="ov-k">Offene Alarme</span>
          <span className="ov-v" style={{ color: openAlerts.length ? 'var(--dangerS)' : 'var(--ok)' }}>
            {openAlerts.length}
          </span>
          <span className="ov-n">
            {openAlerts.length === 0 ? 'alles ruhig' : `${ackedAlerts} quittiert`}
          </span>
        </button>
      </div>

      <div className="ov-band">
        <section className="card" aria-labelledby="ov-load-h">
          <div className="ov-card-head">
            <h2 id="ov-load-h">Flottenlast, letzte 24 Stunden</h2>
            <span className="ov-note">Ø CPU über alle Geräte, die gemeldet haben</span>
          </div>
          <div className="ov-card-body">
            <LoadChart samples={samples} />
          </div>
        </section>

        <section className="card" aria-labelledby="ov-state-h">
          <div className="ov-card-head">
            <h2 id="ov-state-h">Flotte nach Zustand</h2>
          </div>
          <div className="ov-card-body">
            <div className="ov-statebar" role="presentation">
              {(['ok', 'warn', 'crit', 'off'] as const).map(
                (k) =>
                  buckets[k] > 0 && (
                    <span
                      key={k}
                      style={{
                        flex: buckets[k],
                        background:
                          k === 'ok'
                            ? 'var(--ok)'
                            : k === 'warn'
                              ? 'var(--warn)'
                              : k === 'crit'
                                ? 'var(--dangerS)'
                                : 'var(--tx3)',
                      }}
                    />
                  ),
              )}
            </div>
            <div className="ov-legend">
              <button className="ov-legend-row" type="button" onClick={() => onNavigate('devices')}>
                <span className="ov-sw" style={{ background: 'var(--ok)' }} />
                <span>In Ordnung</span>
                <span className="ov-num">{buckets.ok}</span>
              </button>
              <button
                className="ov-legend-row"
                type="button"
                onClick={() => onNavigate('devices', 'filter=probleme')}
              >
                <span className="ov-sw" style={{ background: 'var(--warn)' }} />
                <span>Warnung · Platte ab 80 %</span>
                <span className="ov-num">{buckets.warn}</span>
              </button>
              <button
                className="ov-legend-row"
                type="button"
                onClick={() => onNavigate('devices', 'filter=probleme')}
              >
                <span className="ov-sw" style={{ background: 'var(--dangerS)' }} />
                <span>Kritisch · Platte ab 90 %</span>
                <span className="ov-num">{buckets.crit}</span>
              </button>
              <button
                className="ov-legend-row"
                type="button"
                onClick={() => onNavigate('devices', 'filter=offline')}
              >
                <span className="ov-sw" style={{ background: 'var(--tx3)' }} />
                <span>Offline</span>
                <span className="ov-num">{buckets.off}</span>
              </button>
            </div>
            <p className="ov-footnote">Jede Zeile führt auf die Geräteseite mit diesem Filter.</p>
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="ov-act-h">
        <div className="ov-card-head">
          <h2 id="ov-act-h">Letzte Aktivität</h2>
          <button className="link-btn ov-note" onClick={() => onNavigate('audit')}>
            Audit-Log →
          </button>
        </div>
        <div className="ov-card-body">
          {activity === null ? (
            <span className="muted">Lade…</span>
          ) : activity.length === 0 ? (
            <span className="muted">Keine Ereignisse.</span>
          ) : (
            <div className="ov-act">
              {activity.slice(0, 5).map((ev) => (
                <div key={ev.id} className="ov-act-row">
                  <span className="ov-act-time" title={formatRelative(ev.ts)}>
                    {hhmm(ev.ts)}
                  </span>
                  <span className={`badge ${AUDIT_CATEGORY[ev.category]?.tone ?? ''} ov-act-cat`}>
                    {AUDIT_CATEGORY[ev.category]?.label ?? ev.category}
                  </span>
                  <span className="ov-act-text">{describeAudit(ev, names)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
