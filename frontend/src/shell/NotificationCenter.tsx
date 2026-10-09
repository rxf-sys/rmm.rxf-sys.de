import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { qk } from '../api/queryClient';
import { alertStatusKind } from '../deviceStatus';
import { formatRelative } from '../format';
import { IconBell } from '../icons';
import { PAGE_PATH, devicePath } from '../routes';
import type { Alert, Device } from '../types';
import { Popover, StatusBadge, usePopoverClose } from '../ui';
import { notify, useJobResults } from '../ui/toast';

interface Props {
  alerts: Alert[];
  devices: Device[];
}

const MAX_ALERTS = 6;

function Body({ alerts, devices }: Props) {
  const close = usePopoverClose();
  const qc = useQueryClient();
  const results = useJobResults();
  const open = alerts.filter((a) => a.resolved_at === null);
  // Unacknowledged first, newest first within each group.
  const sorted = [...open].sort(
    (a, b) => Number(a.acked_at !== null) - Number(b.acked_at !== null) || b.fired_at - a.fired_at,
  );
  const ack = useMutation({
    mutationFn: (id: number) => api.ackAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alerts }),
    onError: (e) => notify.error('Quittieren fehlgeschlagen', e),
  });
  const byId = new Map(devices.map((d) => [d.id, d]));
  const name = (id: number) => byId.get(id)?.hostname ?? `Gerät ${id}`;

  return (
    <div className="nc">
      <div className="nc-head">
        <h2>Benachrichtigungen</h2>
        <Link to={PAGE_PATH.alerts} className="link-btn" onClick={close}>
          Alarm-Center
        </Link>
      </div>

      <section aria-labelledby="nc-alerts">
        <h3 id="nc-alerts" className="nc-section">
          Offene Alarme <span className="num">{open.length}</span>
        </h3>
        {sorted.length === 0 ? (
          <p className="nc-empty">Keine offenen Alarme. Die Flotte ist ruhig.</p>
        ) : (
          <ul className="nc-list">
            {sorted.slice(0, MAX_ALERTS).map((a) => (
              <li key={a.id} className={a.acked_at ? 'nc-item acked' : 'nc-item'}>
                <StatusBadge
                  kind={alertStatusKind(a, byId.get(a.device_id))}
                  iconOnly
                  plain
                  label={a.rule === 'offline' ? 'Offline' : 'Alarm'}
                />
                <div className="nc-text">
                  <Link to={devicePath(a.device_id)} onClick={close} className="nc-title">
                    {a.message}
                  </Link>
                  <span className="nc-meta">
                    {name(a.device_id)} · {formatRelative(a.fired_at)}
                    {a.acked_at ? ` · quittiert von ${a.acked_by}` : ''}
                  </span>
                </div>
                {!a.acked_at && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={ack.isPending && ack.variables === a.id}
                    onClick={() => ack.mutate(a.id)}
                  >
                    Quittieren
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {sorted.length > MAX_ALERTS && (
          <Link to={PAGE_PATH.alerts} className="nc-more" onClick={close}>
            {sorted.length - MAX_ALERTS} weitere im Alarm-Center
          </Link>
        )}
      </section>

      {results.length > 0 && (
        <section aria-labelledby="nc-jobs">
          <h3 id="nc-jobs" className="nc-section">
            Deine Aufträge
          </h3>
          <ul className="nc-list">
            {results.slice(0, 5).map((r) => (
              <li key={r.jobId} className="nc-item">
                <StatusBadge
                  kind={r.status === 'done' ? 'ok' : 'danger'}
                  iconOnly
                  plain
                  label={r.status === 'done' ? 'Erfolgreich' : 'Fehlgeschlagen'}
                />
                <div className="nc-text">
                  <Link to={`${devicePath(r.deviceId)}?tab=jobs&job=${r.jobId}`} onClick={close} className="nc-title">
                    {r.label}
                  </Link>
                  <span className="nc-meta">
                    {r.deviceName} · {formatRelative(r.finishedAt)}
                    {r.exitCode !== null ? ` · Exit ${r.exitCode}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The bell: open alerts with quick acknowledge, plus this tab's job results. */
export function NotificationCenter({ alerts, devices }: Props) {
  const unacked = alerts.filter((a) => a.resolved_at === null && a.acked_at === null).length;
  return (
    <Popover
      label="Benachrichtigungen"
      placement="bottom-end"
      className="popover-nc"
      trigger={(t) => (
        <button
          {...t}
          type="button"
          className="btn-icon ghost"
          aria-label={unacked ? `Benachrichtigungen, ${unacked} offene Alarme` : 'Benachrichtigungen'}
        >
          <IconBell size={17} />
          {unacked > 0 && <span className="count-notify">{unacked > 99 ? '99+' : unacked}</span>}
        </button>
      )}
    >
      <Body alerts={alerts} devices={devices} />
    </Popover>
  );
}
