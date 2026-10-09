import './overview.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import { AUDIT_CATEGORY, auditNamesFrom, describeAudit } from '../../auditText';
import { isAgent } from '../../deviceClass';
import { niceCeiling } from '../../fleetChart';
import { formatRelative } from '../../format';
import type { Fleet } from '../../hooks/useFleet';
import { IconBell, IconChevronRight, IconPlus, IconShield, IconStatusDanger, IconStatusOk } from '../../icons';
import { buildTasks, verdict, type OverviewTask, type TaskTarget } from '../../overviewTasks';
import { PAGE_PATH, devicePath, type PageId } from '../../routes';
import type { Account } from '../../types';
import { EmptyState, LineChart, PageHeader, Panel, Skeleton, StatusBadge, type StatusKind } from '../../ui';
import { FleetMap } from './FleetMap';

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
const fmt = new Intl.NumberFormat('de-DE');

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

const hhmm = (ts: number) => new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function taskKind(t: OverviewTask): StatusKind {
  if (t.tag === 'offline') return 'off';
  return t.severity === 'crit' ? 'danger' : t.severity === 'warn' ? 'warn' : 'info';
}

const TAG_LABEL: Record<string, string> = {
  kritisch: 'Kritisch',
  sicherheit: 'Sicherheit',
  offline: 'Offline',
  platte: 'Platte',
  scan: 'Scan',
  agent: 'Agent',
  updates: 'Updates',
};

function targetPath(t: TaskTarget): string {
  return t.kind === 'device' ? devicePath(t.id) : `${PAGE_PATH[t.page]}${t.query ? `?${t.query}` : ''}`;
}

function TaskItem({ task }: { task: OverviewTask }) {
  return (
    <li className="ov-task">
      <StatusBadge kind={taskKind(task)} label={TAG_LABEL[task.tag] ?? task.tag} />
      <div className="ov-task-body">
        <span className="ov-task-title">{task.title}</span>
        <span className="ov-task-why">{task.why}</span>
      </div>
      <Link className="ov-task-go" to={targetPath(task.target)}>
        {task.actionLabel.replace(/\s*→\s*$/, '')}
        <IconChevronRight size={14} />
      </Link>
    </li>
  );
}

function Stat({
  to,
  icon,
  label,
  value,
  context,
  tone,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  context: string;
  tone?: 'warn' | 'danger' | 'ok';
}) {
  return (
    <Link to={to} className={tone ? `ov-stat ${tone}` : 'ov-stat'}>
      <span className="ov-stat-label">
        {icon}
        {label}
      </span>
      <span className="ov-stat-value">{value}</span>
      <span className="ov-stat-context">{context}</span>
    </Link>
  );
}

export function OverviewPage({ fleet, user, onOpenEnroll, canEnroll }: Props) {
  const { devices, alerts, patchSummary, loading, loadedAt } = fleet;
  // Die Aufgaben rechnen mit „jetzt" („seit 3 Tagen offline"), also muss die
  // Uhr laufen — sonst altert die Seite still, solange der Tab offen bleibt.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [allTasks, setAllTasks] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  // Aktivität ist Admin-Sache: für alle anderen antwortet der Endpunkt mit
  // 403 — dann fehlt die Karte, statt „Keine Ereignisse" zu behaupten.
  const activity = useQuery({
    queryKey: ['overview', 'activity'],
    queryFn: ({ signal }) => api.audit({ limit: 6 }, signal).then((r) => r.events),
    refetchInterval: 60_000,
    retry: false,
  });
  const activityHidden = activity.error instanceof ApiError && activity.error.status === 403;
  const metrics = useQuery({
    queryKey: ['fleet-metrics', CHART_HOURS],
    queryFn: ({ signal }) => api.fleetMetrics(CHART_HOURS, signal).then((r) => r.samples),
    refetchInterval: 5 * 60_000,
  });

  const names = useMemo(() => auditNamesFrom(devices), [devices]);
  // „Zu tun" und die Zustandszahlen beschreiben Geräte mit Agent: nur die
  // melden sich, nur bei denen heißt Schweigen etwas.
  const agents = useMemo(() => devices.filter(isAgent), [devices]);
  const mobileCount = devices.length - agents.length;
  const tasks = useMemo(() => buildTasks({ devices: agents, patchSummary, now }), [agents, patchSummary, now]);
  const head = verdict(agents, tasks);

  const online = agents.filter((d) => d.online).length;
  const summaries = Object.values(patchSummary);
  const pending = summaries.reduce((a, s) => a + s.pending, 0);
  const security = summaries.reduce((a, s) => a + s.security, 0);
  const patchedDevices = summaries.filter((s) => s.pending > 0).length;
  const securityDevices = summaries.filter((s) => s.security > 0).length;
  const openAlerts = alerts.filter((a) => a.resolved_at === null);
  const ackedAlerts = openAlerts.filter((a) => a.acked_at !== null).length;

  const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const sub = [
    date,
    agents.length > 0 ? `${fmt.format(online)} von ${fmt.format(agents.length)} Geräten melden sich planmäßig` : null,
    mobileCount > 0 ? `${fmt.format(mobileCount)} ohne Agent` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const verdictKind: StatusKind =
    head.severity === 'crit' ? 'danger' : head.severity === 'warn' ? 'warn' : head.severity === 'ok' ? 'ok' : 'info';

  if (loading && devices.length === 0) {
    return (
      <div className="screen" aria-busy="true">
        <Skeleton h={64} />
        <Skeleton h={140} />
        <Skeleton h={96} />
      </div>
    );
  }

  const samples = metrics.data ?? [];
  const from = now - CHART_HOURS * 3600;
  const yMax = niceCeiling(Math.max(10, ...samples.map((s) => Math.max(s.cpu_avg, s.mem_avg))));
  const ticks: number[] = [];
  for (let t = Math.ceil(from / (6 * 3600)) * 6 * 3600; t <= now; t += 6 * 3600) ticks.push(t);
  const mean = samples.length ? samples.reduce((a, s) => a + s.cpu_avg, 0) / samples.length : 0;
  const peak = samples.reduce<(typeof samples)[number] | null>((a, s) => (!a || s.cpu_avg > a.cpu_avg ? s : a), null);

  return (
    <div className="screen ov">
      <PageHeader
        title={`${greeting()}, ${user.username}`}
        subtitle={
          <>
            <span>{sub}</span>
            <span className="ov-verdict">
              <StatusBadge kind={verdictKind} label={head.text} />
            </span>
          </>
        }
      />

      {devices.length === 0 ? (
        <EmptyState
          icon={<IconPlus size={20} />}
          title="Noch keine Geräte"
          actions={
            canEnroll ? (
              <button className="btn btn-primary" onClick={onOpenEnroll}>
                <IconPlus size={15} /> Gerät hinzufügen
              </button>
            ) : undefined
          }
        >
          Installiere den Agenten auf dem ersten Rechner oder lege ein Telefon von Hand an. Danach
          erscheint hier, was in der Flotte passiert.
        </EmptyState>
      ) : (
        <>
          <Panel
            title="Lagebild"
            meta={`${fmt.format(devices.length)} Geräte`}
            actions={
              loadedAt ? (
                <span className="ov-live">
                  <span className="ov-live-dot" aria-hidden />
                  live · Stand {hhmm(loadedAt)}
                </span>
              ) : undefined
            }
          >
            <FleetMap devices={devices} />
          </Panel>

          <section className="panel ov-stats" aria-label="Kennzahlen">
            <Stat
              to={PAGE_PATH.devices}
              icon={<IconStatusOk size={15} />}
              label="Online"
              value={
                <>
                  {fmt.format(online)}
                  <small> / {fmt.format(agents.length)}</small>
                </>
              }
              context={`${fmt.format(agents.length - online)} offline${mobileCount ? ` · ${fmt.format(mobileCount)} ohne Agent` : ''}`}
            />
            <Stat
              to={PAGE_PATH.patches}
              icon={<IconShield size={15} />}
              label="Offene Updates"
              value={fmt.format(pending)}
              context={pending ? `auf ${fmt.format(patchedDevices)} Geräten` : 'alles aktuell'}
              tone={pending ? 'warn' : undefined}
            />
            <Stat
              to={PAGE_PATH.patches}
              icon={<IconStatusDanger size={15} />}
              label="Sicherheitsupdates"
              value={fmt.format(security)}
              context={security ? `auf ${fmt.format(securityDevices)} Geräten` : 'nichts offen'}
              tone={security ? 'danger' : 'ok'}
            />
            <Stat
              to={PAGE_PATH.alerts}
              icon={<IconBell size={15} />}
              label="Offene Alarme"
              value={fmt.format(openAlerts.length)}
              context={openAlerts.length ? `${fmt.format(ackedAlerts)} quittiert` : 'alles ruhig'}
              tone={openAlerts.length - ackedAlerts > 0 ? 'danger' : openAlerts.length ? 'warn' : 'ok'}
            />
          </section>

          <div className="ov-grid">
            <Panel
              title="Zu tun"
              meta={tasks.length === 0 ? 'nichts offen' : `${fmt.format(tasks.length)} Punkt${tasks.length === 1 ? '' : 'e'}, wichtigste zuerst`}
              padded={false}
            >
              {tasks.length === 0 ? (
                <p className="ov-nothing">
                  <StatusBadge kind="ok" label="Alles erledigt" />
                  Platten unter 80 %, keine Sicherheitsupdates offen, alle Geräte erreichbar.
                </p>
              ) : (
                <>
                  <ul className="ov-tasks">
                    {(allTasks ? tasks : tasks.slice(0, MAX_TASKS)).map((t) => (
                      <TaskItem key={t.id} task={t} />
                    ))}
                  </ul>
                  {!allTasks && tasks.length > MAX_TASKS && (
                    <button className="ov-more" type="button" onClick={() => setAllTasks(true)}>
                      {tasks.length - MAX_TASKS} weitere anzeigen
                    </button>
                  )}
                </>
              )}
            </Panel>

            <div className="ov-side">
              <Panel title="Flottenlast" meta={`Ø über alle meldenden Geräte · ${CHART_HOURS} h`}>
                {metrics.isPending ? (
                  <Skeleton h={180} />
                ) : samples.length < 2 ? (
                  <p className="ov-chart-empty">
                    Noch zu wenige Messpunkte — die Kurve entsteht aus den Heartbeats der letzten{' '}
                    {CHART_HOURS} Stunden.
                  </p>
                ) : (
                  <LineChart
                    from={from}
                    to={now}
                    yMax={yMax}
                    summary={`Flottenlast über ${CHART_HOURS} Stunden: CPU im Mittel ${Math.round(mean)} Prozent${peak ? `, Spitze ${Math.round(peak.cpu_avg)} Prozent um ${hhmm(peak.ts)}` : ''}.`}
                    formatTime={(ts) => `${dayTime(ts)} · ${samples.find((s) => s.ts === ts)?.devices ?? 0} Geräte`}
                    formatTick={hhmm}
                    ticks={ticks}
                    series={[
                      { key: 'cpu', label: 'CPU Ø', color: 'var(--s1)', points: samples.map((s) => ({ ts: s.ts, v: s.cpu_avg })) },
                      { key: 'mem', label: 'RAM Ø', color: 'var(--s2)', points: samples.map((s) => ({ ts: s.ts, v: s.mem_avg })) },
                    ]}
                  />
                )}
              </Panel>

              {!activityHidden && (
                <Panel
                  title="Letzte Aktivität"
                  padded={false}
                  actions={
                    <Link to={PAGE_PATH.audit} className="link-btn">
                      Audit-Log <IconChevronRight size={14} />
                    </Link>
                  }
                >
                  {activity.isPending ? (
                    <div className="ov-pad">
                      <Skeleton h={120} />
                    </div>
                  ) : !activity.data || activity.data.length === 0 ? (
                    <p className="ov-chart-empty ov-pad">Noch keine Ereignisse.</p>
                  ) : (
                    <ul className="ov-acts">
                      {activity.data.slice(0, 5).map((ev) => (
                        <li key={ev.id}>
                          <time dateTime={new Date(ev.ts * 1000).toISOString()} title={formatRelative(ev.ts)}>
                            {hhmm(ev.ts)}
                          </time>
                          <span className="badge">{AUDIT_CATEGORY[ev.category]?.label ?? ev.category}</span>
                          <span className="ov-act-text">{describeAudit(ev, names)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
