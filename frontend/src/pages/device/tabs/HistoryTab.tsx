import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNow } from '../../../hooks/useNow';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { FilterBar } from '../../../components/FilterBar';
import { formatAgo, formatDateTime } from '../../../format';
import type { Alert, MetricSample } from '../../../types';
import { EmptyState, ErrorNote, LineChart, Panel, Skeleton, StatusBadge, type ChartSeries } from '../../../ui';
import { IconStatusOk } from '../../../icons';
import { dayTick, hhmm, ticksFor } from '../timeAxis';

const RANGES = [
  { id: '6', label: '6 h', hours: 6, tickS: 3600 },
  { id: '24', label: '24 h', hours: 24, tickS: 4 * 3600 },
  { id: '168', label: '7 Tage', hours: 168, tickS: 24 * 3600 },
];

const RULE_LABEL: Record<string, string> = {
  offline: 'Offline',
  disk: 'Platte',
  patch_age: 'Updates',
  mdm_silent: 'MDM stumm',
  mdm_passcode: 'Gerätecode',
  mdm_identity: 'Zertifikat',
};

function chartSummary(samples: MetricSample[], label: string): string {
  if (samples.length === 0) return `Keine Messwerte in den letzten ${label}.`;
  const peak = (k: keyof MetricSample) => Math.round(Math.max(...samples.map((s) => s[k])));
  return `Auslastung der letzten ${label}: Spitzen CPU ${peak('cpu_pct')} Prozent, Arbeitsspeicher ${peak('mem_pct')} Prozent, Platte ${peak('disk_max_pct')} Prozent.`;
}

function AlertRow({ a }: { a: Alert }) {
  return (
    <li className="dv-alert">
      <StatusBadge kind={a.resolved_at ? 'ok' : a.rule === 'offline' ? 'off' : 'warn'} label={a.resolved_at ? 'behoben' : 'offen'} />
      <span className="dv-alert-msg">{a.message}</span>
      <span className="dv-alert-when" title={formatDateTime(a.fired_at)}>
        {formatAgo(a.fired_at)}
        {a.resolved_at ? ` · behoben ${formatAgo(a.resolved_at)}` : ''}
      </span>
    </li>
  );
}

/** Load over time and the alerts of the last 30 days. */
export function HistoryTab({ deviceId }: { deviceId: number }) {
  const [rangeId, setRangeId] = useState('24');
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1]!;
  // The x axis runs up to "now"; without a ticking clock the chart would
  // stand still while the tab stays open.
  const now = useNow();

  const history = useQuery({
    queryKey: qk.deviceHistory(deviceId, range.hours),
    queryFn: ({ signal }) => api.deviceHistory(deviceId, range.hours, signal).then((r) => r.samples),
    refetchInterval: 60_000,
  });
  const alerts = useQuery({
    queryKey: qk.deviceAlerts(deviceId),
    queryFn: ({ signal }) => api.deviceAlerts(deviceId, signal),
  });

  const samples = history.data ?? [];
  const from = now - range.hours * 3600;
  const series: ChartSeries[] = [
    { key: 'cpu', label: 'CPU', color: 'var(--s1)', points: samples.map((s) => ({ ts: s.ts, v: s.cpu_pct })) },
    { key: 'ram', label: 'Arbeitsspeicher', color: 'var(--s2)', points: samples.map((s) => ({ ts: s.ts, v: s.mem_pct })) },
    { key: 'disk', label: 'Platte (vollste)', color: 'var(--s3)', dashed: true, points: samples.map((s) => ({ ts: s.ts, v: s.disk_max_pct })) },
  ];

  return (
    <div className="dv-stack">
      <Panel
        title="Auslastung"
        meta="aus den Meldungen des Agents · Lücken: das Gerät hat nichts gemeldet"
        actions={
          <FilterBar
            options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
            value={rangeId}
            onChange={setRangeId}
            label="Zeitraum"
          />
        }
      >
        {history.error ? (
          <ErrorNote error={history.error} onRetry={() => void history.refetch()} />
        ) : history.isPending ? (
          <Skeleton h={220} />
        ) : samples.length === 0 ? (
          <EmptyState title="Keine Messwerte">In diesem Zeitraum hat das Gerät nichts gemeldet.</EmptyState>
        ) : (
          <LineChart
            series={series}
            from={from}
            to={now}
            yMax={100}
            height={220}
            // Raw heartbeats up to 48 h, hourly averages beyond.
            gapS={range.hours <= 48 ? 600 : 1.5 * 3600}
            summary={chartSummary(samples, range.label)}
            formatTime={(ts) => (range.hours > 24 ? `${dayTick(ts)} ${hhmm(ts)}` : hhmm(ts))}
            formatTick={range.hours > 24 ? dayTick : hhmm}
            ticks={ticksFor(from, now, range.tickS)}
          />
        )}
      </Panel>

      <Panel
        title="Alarme der letzten 30 Tage"
        meta={
          alerts.data &&
          (alerts.data.stats.total === 0
            ? 'kein Alarm'
            : `${alerts.data.stats.total} insgesamt · ${alerts.data.stats.open} offen · ${Object.entries(alerts.data.stats.by_rule)
                .map(([rule, n]) => `${RULE_LABEL[rule] ?? rule} ${n}×`)
                .join(', ')}`)
        }
        padded={false}
      >
        {alerts.error ? (
          <div className="dv-pad">
            <ErrorNote error={alerts.error} onRetry={() => void alerts.refetch()} />
          </div>
        ) : alerts.isPending ? (
          <div className="dv-pad">
            <Skeleton h={60} />
          </div>
        ) : alerts.data.alerts.length === 0 ? (
          <EmptyState icon={<IconStatusOk size={22} />} title="Ruhig">
            In den letzten 30 Tagen hat dieses Gerät keinen Alarm ausgelöst.
          </EmptyState>
        ) : (
          <ul className="dv-alerts">
            {alerts.data.alerts.map((a) => (
              <AlertRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
