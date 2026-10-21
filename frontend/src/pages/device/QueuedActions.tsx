import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { formatAgo, formatDateTime } from '../../format';
import { IconClock } from '../../icons';
import { ACTION_STATE, DEFAULT_TTL_HOURS, TTL_OPTIONS, actionOrigin, actionTitle, isOpen } from '../../pendingActions';
import type { Device, PendingAction } from '../../types';
import { ErrorNote, Panel, SkeletonRows, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';

interface Props {
  device: Pick<Device, 'id' | 'os' | 'connected'>;
  /** `updates`: the install form and update/reboot actions only (Updates
   *  tab). `all`: scripts too (Aktivität tab). */
  mode: 'updates' | 'all';
}

function ActionRow({
  a,
  scriptName,
  onCancel,
  cancelling,
}: {
  a: PendingAction;
  scriptName: (id: number) => string | undefined;
  onCancel: (a: PendingAction) => void;
  cancelling: boolean;
}) {
  const state = ACTION_STATE[a.state];
  return (
    <li className="qa-item">
      <div className="qa-main">
        <span className="qa-title">{actionTitle(a, scriptName)}</span>
        <span className="qa-meta">
          {actionOrigin(a)} · <span title={formatDateTime(a.created_at)}>{formatAgo(a.created_at)}</span>
          {a.state === 'pending' && a.expires_at && (
            <>
              {' '}
              · gilt bis <span title={formatDateTime(a.expires_at)}>{new Date(a.expires_at * 1000).toLocaleDateString('de-DE')}</span>
            </>
          )}
          {a.note && <> · {a.note}</>}
        </span>
      </div>
      <StatusBadge kind={state.kind} label={state.label} />
      {a.state === 'pending' && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-disabled={cancelling || undefined}
          onClick={() => !cancelling && onCancel(a)}
        >
          Zurückziehen
        </button>
      )}
    </li>
  );
}

/**
 * What waits for this device's next time online, and the forms to queue
 * more: install updates (optionally security only, optionally restart
 * afterwards) and — on the activity tab — run a library script.
 *
 * Queued for a device that is online right now, the server runs it at once;
 * the list then shows it as running.
 */
export function QueuedActions({ device, mode }: Props) {
  const qc = useQueryClient();
  const id = useId();
  const [securityOnly, setSecurityOnly] = useState(false);
  const [reboot, setReboot] = useState(false);
  const [ttl, setTtl] = useState(DEFAULT_TTL_HOURS);
  const [scriptId, setScriptId] = useState(0);

  const actions = useQuery({
    queryKey: qk.deviceActions(device.id),
    queryFn: ({ signal }) => api.deviceActions(device.id, signal).then((r) => r.actions),
  });
  const scriptsQ = useQuery({
    queryKey: qk.scripts,
    queryFn: ({ signal }) => api.scripts(signal).then((r) => r.scripts),
  });
  const scriptName = useMemo(() => {
    const names = new Map((scriptsQ.data ?? []).map((s) => [s.id, s.name]));
    return (sid: number) => names.get(sid);
  }, [scriptsQ.data]);
  const runnable = (scriptsQ.data ?? []).filter((s) => s.os === 'any' || s.os === device.os);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.deviceActions(device.id) });
    void qc.invalidateQueries({ queryKey: qk.devices });
  };

  const queue = useMutation({
    mutationFn: (body: Parameters<typeof api.queueAction>[1]) => api.queueAction(device.id, body),
    onSuccess: (r) => {
      refresh();
      if (r.dispatched_job_ids.length > 0) notify.success('Gerät ist online — läuft jetzt');
      else if (!r.created) notify.info('Vormerkung ergänzt', 'Es gab schon eine; sie gilt jetzt mit den neuen Angaben.');
      else notify.success('Vorgemerkt', 'Läuft, sobald sich das Gerät das nächste Mal meldet.');
    },
    onError: (e) => notify.error('Nicht vorgemerkt', e),
  });
  const cancel = useMutation({
    mutationFn: (a: PendingAction) => api.cancelAction(device.id, a.id),
    onSuccess: () => {
      refresh();
      notify.success('Zurückgezogen');
    },
    onError: (e) => notify.error('Nicht zurückgezogen', e),
  });

  const list = (actions.data ?? []).filter((a) => mode === 'all' || a.kind !== 'script');
  const open = list.filter(isOpen);
  const closed = list.filter((a) => !isOpen(a)).slice(0, 5);
  const busy = queue.isPending;

  return (
    <Panel
      title={device.connected ? 'Vormerken' : 'Beim nächsten Online-Gehen'}
      meta={open.length > 0 ? `${open.length} offen` : undefined}
    >
      <div className="qa">
        <p className="dv-note">
          <IconClock size={14} />
          {device.connected
            ? 'Das Gerät ist verbunden: Vorgemerktes läuft sofort. Ist es offline, wartet es auf die nächste Meldung.'
            : 'Das Gerät meldet sich gerade nicht. Vorgemerktes läuft, sobald es wieder online ist.'}
        </p>

        <form
          className="qa-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) queue.mutate({ kind: 'patch_install', security_only: securityOnly, reboot, expires_hours: ttl });
          }}
        >
          <span className="qa-form-title">Updates installieren</span>
          <label className="choice">
            <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} />
            nur Sicherheitsupdates
          </label>
          <label className="choice">
            <input type="checkbox" checked={reboot} onChange={(e) => setReboot(e.target.checked)} />
            danach neu starten, falls nötig
          </label>
          <label className="qa-ttl" htmlFor={`${id}-ttl`}>
            gilt
            <select id={`${id}-ttl`} className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {TTL_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-sm btn-primary" aria-disabled={busy || undefined}>
            Vormerken
          </button>
        </form>

        {mode === 'all' && (
          <form
            className="qa-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && scriptId) queue.mutate({ kind: 'script', script_id: scriptId, expires_hours: ttl });
            }}
          >
            <label className="qa-form-title" htmlFor={`${id}-script`}>
              Skript ausführen
            </label>
            <select
              id={`${id}-script`}
              className="input qa-script"
              value={scriptId}
              onChange={(e) => setScriptId(Number(e.target.value))}
              disabled={scriptsQ.isPending}
            >
              <option value={0}>{scriptsQ.isPending ? 'Lädt …' : runnable.length ? 'Skript wählen …' : 'Kein passendes Skript'}</option>
              {runnable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-sm" aria-disabled={busy || !scriptId || undefined}>
              Vormerken
            </button>
          </form>
        )}

        {actions.error ? (
          <ErrorNote error={actions.error} onRetry={() => void actions.refetch()} />
        ) : actions.isPending ? (
          <SkeletonRows rows={2} h={36} />
        ) : list.length > 0 ? (
          <ul className="qa-list" aria-label="Vorgemerkte Aktionen">
            {[...open, ...closed].map((a) => (
              <ActionRow key={a.id} a={a} scriptName={scriptName} onCancel={(x) => cancel.mutate(x)} cancelling={cancel.isPending} />
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
