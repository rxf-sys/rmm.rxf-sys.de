import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, apiErrorMessage } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatAgo, formatDateTime } from '../../../format';
import { useNow } from '../../../hooks/useNow';
import { ASSIGNMENT_STATE, CONFIG_KIND_LABEL } from '../../../mdm';
import type { DeviceMdm, MdmBinding } from '../../../types';
import { KeyValue, Panel, StatusBadge } from '../../../ui';
import { notify } from '../../../ui/toast';

function ago(ts: number | null, now: number): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
}

/** Profiles from the template library on this phone: what is there, what is
 *  on its way, and a picker for the rest. */
export function MdmConfigsPanel({ deviceId, mdm, isAdmin }: { deviceId: number; mdm: DeviceMdm; isAdmin: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [pick, setPick] = useState(0);
  const library = useQuery({
    queryKey: qk.mdmConfigs,
    queryFn: ({ signal }) => api.mdmConfigs(signal),
    enabled: isAdmin,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
    void qc.invalidateQueries({ queryKey: qk.mdmConfigs });
  };
  const assign = useMutation({
    mutationFn: (configId: number) => api.mdmAssignConfig(deviceId, configId),
    onSuccess: () => {
      setPick(0);
      refresh();
      notify.success('Profil verschickt', 'Das Gerät installiert es beim nächsten Kontakt.');
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });
  const remove = useMutation({
    mutationFn: (configId: number) => api.mdmRemoveConfig(deviceId, configId),
    onSuccess: () => {
      refresh();
      notify.success('Wird entfernt');
    },
    onError: (e) => notify.error('Nicht entfernt', e),
  });
  const reason = mdm.actions.profiles;
  const assigned = new Set(mdm.configs.map((c) => c.config_id));
  const free = (library.data?.configs ?? []).filter((c) => !assigned.has(c.id));

  return (
    <Panel title="Profile" meta={mdm.configs.length ? `${mdm.configs.length} zugewiesen` : undefined}>
      {mdm.configs.length > 0 ? (
        <ul className="dv-mdm-list" aria-label="Zugewiesene Profile">
          {mdm.configs.map((c) => {
            const st = ASSIGNMENT_STATE[c.state];
            const outdated = c.state === 'installed' && c.version < c.current_version;
            return (
              <li key={c.config_id}>
                <span className="dv-mdm-item-name">{c.name}</span>
                <span className="muted">
                  {CONFIG_KIND_LABEL[c.kind]}
                  {c.error && <> · {c.error}</>}
                  {outdated && <> · ältere Fassung</>}
                </span>
                <StatusBadge kind={st.kind} label={st.label} size={12} />
                {isAdmin && c.state !== 'removing' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={reason !== null || remove.isPending}
                    onClick={() => remove.mutate(c.config_id)}
                  >
                    Entfernen
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dv-note">Noch kein Profil auf diesem Gerät.</p>
      )}
      {isAdmin && (
        <form
          className="dv-mdm-assign"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick && !assign.isPending) assign.mutate(pick);
          }}
        >
          <label className="sr-only" htmlFor={`${id}-pick`}>
            Profil auswählen
          </label>
          <select
            id={`${id}-pick`}
            className="input"
            value={pick}
            onChange={(e) => setPick(Number(e.target.value))}
            disabled={reason !== null || library.isPending}
          >
            <option value={0}>
              {library.isPending ? 'Lädt …' : free.length ? 'Profil auswählen …' : 'Keine weiteren Profile'}
            </option>
            {free.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({CONFIG_KIND_LABEL[c.kind]})
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!pick || reason !== null || assign.isPending}>
            Installieren
          </button>
        </form>
      )}
      {reason && <p className="dv-note">{reason}</p>}
      <p className="dv-note">Vorlagen werden unter Administration → MDM-Profile angelegt.</p>
    </Panel>
  );
}

const UPDATE_STATE: Record<string, string> = {
  none: 'kein Update ansteht',
  downloading: 'lädt herunter',
  'download-failed': 'Download fehlgeschlagen',
  'download-requires-computer': 'braucht einen Computer',
  'download-insufficient-space': 'zu wenig Speicher',
  'download-insufficient-power': 'Akku zu schwach',
  'download-insufficient-network': 'kein passendes Netz',
  installing: 'installiert',
  'install-insufficient-space': 'zu wenig Speicher',
  'install-insufficient-power': 'Akku zu schwach',
  'install-phone-call-in-progress': 'Telefonat läuft',
  'install-failed': 'Installation fehlgeschlagen',
};

/** Enforce an iOS version by a deadline (Declarative Device Management).
 *  Marked as a test: Apple lists it for unsupervised devices from iOS 17,
 *  but it has not been seen on a real phone here yet. */
export function MdmOsUpdatePanel({ deviceId, mdm, isAdmin }: { deviceId: number; mdm: DeviceMdm; isAdmin: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const now = useNow();
  const current = mdm.os_update;
  const [version, setVersion] = useState(current.target_version);
  const [when, setWhen] = useState(current.target_at.slice(0, 16));
  const save = useMutation({
    mutationFn: (body: { version: string; at: string }) => api.mdmOsUpdate(deviceId, body.version, body.at),
    onSuccess: (_r, body) => {
      void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
      notify.success(body.version ? 'Update-Vorgabe verschickt' : 'Vorgabe aufgehoben');
    },
  });
  const reason = mdm.actions.os_update;
  const state = current.status['softwareupdate.install-state'];
  const pending = current.status['softwareupdate.pending-version.os-version'];
  const reported = current.status['device.operating-system.version'];
  const rows: [ReactNode, ReactNode][] = [
    ['Vorgabe', current.target_version ? `iOS ${current.target_version} bis ${current.target_at.replace('T', ' ').slice(0, 16)}` : 'keine'],
  ];
  if (reported) rows.push(['Gemeldete Version', <span className="num">{String(reported)}</span>]);
  if (state) rows.push(['Update-Stand', UPDATE_STATE[String(state)] ?? String(state)]);
  if (pending) rows.push(['Ansteht', <span className="num">{String(pending)}</span>]);
  if (current.synced_at) rows.push(['Zuletzt abgeglichen', ago(current.synced_at, now)]);

  return (
    <Panel title="iOS-Update erzwingen" meta="Test">
      <KeyValue rows={rows} />
      {isAdmin && (
        <form
          className="form-stack dv-mdm-osupdate"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate({ version: version.trim(), at: when });
          }}
        >
          <div className="form-2">
            <label className="field" htmlFor={`${id}-v`}>
              <span className="field-label">Zielversion</span>
              <input
                id={`${id}-v`}
                className="input"
                inputMode="decimal"
                placeholder={mdm.binding?.info.OSVersion ? `z. B. ${String(mdm.binding.info.OSVersion)}` : 'z. B. 18.7'}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={reason !== null}
              />
            </label>
            <label className="field" htmlFor={`${id}-t`}>
              <span className="field-label">Spätestens am (Ortszeit des Geräts)</span>
              <input
                id={`${id}-t`}
                className="input"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                disabled={reason !== null}
              />
            </label>
          </div>
          {save.error && (
            <p className="err" role="alert">
              {apiErrorMessage(save.error)}
            </p>
          )}
          <div className="dv-mdm-actions">
            <button type="submit" className="btn btn-sm btn-primary" disabled={reason !== null || save.isPending || !version.trim() || !when}>
              Vorgabe setzen
            </button>
            {current.target_version && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={reason !== null || save.isPending}
                onClick={() => save.mutate({ version: '', at: '' })}
              >
                Vorgabe aufheben
              </button>
            )}
          </div>
        </form>
      )}
      {reason && <p className="dv-note">{reason}</p>}
      <p className="dv-note">
        Ab iOS 17. Das Gerät lädt die Version vorher und installiert sie spätestens zum Termin, auch wenn der Nutzer
        wartet. Ob das ohne Betreuung greift, zeigt der Update-Stand — Apple erlaubt es laut Schema, getestet ist es hier
        noch nicht.
      </p>
    </Panel>
  );
}

function renewalText(b: MdmBinding, now: number): ReactNode {
  const r = b.renewal;
  if (!r.started_at) return null;
  if (r.error) return <span className="dv-mdm-bad">fehlgeschlagen: {r.error}</span>;
  if (r.done_at && r.done_at >= r.started_at) return <>erneuert {ago(r.done_at, now)}</>;
  return <>läuft seit {ago(r.started_at, now)}</>;
}

/** The phone's link to Vulpexa: since when, last contact, certificate. */
export function MdmIdentityPanel({
  deviceId,
  mdm,
  binding,
  isAdmin,
  now,
}: {
  deviceId: number;
  mdm: DeviceMdm;
  binding: MdmBinding;
  isAdmin: boolean;
  now: number;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const renew = useMutation({
    mutationFn: () => api.mdmRenew(deviceId),
    onSuccess: () => {
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
      notify.success('Erneuerung verschickt', 'Das Gerät holt sich beim nächsten Kontakt ein neues Zertifikat.');
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });
  const renewal = renewalText(binding, now);
  const reason = mdm.actions.renew;
  return (
    <Panel
      title="Verwaltung"
      actions={
        isAdmin && !binding.checked_out_at ? (
          <button type="button" className="btn btn-sm" disabled={reason !== null} title={reason ?? undefined} onClick={() => setConfirm(true)}>
            Zertifikat erneuern
          </button>
        ) : undefined
      }
    >
      <KeyValue
        rows={[
          ['Registriert seit', ago(binding.enrolled_at, now)],
          ['Letzter Kontakt', <>{ago(binding.last_seen_at, now)}{mdm.reachable ? ' · erreichbar' : ''}</>],
          ...(binding.checked_out_at ? [['Profil entfernt', ago(binding.checked_out_at, now)] as [ReactNode, ReactNode]] : []),
          ['Zertifikat gültig bis', binding.identity_expires_at ? new Date(binding.identity_expires_at * 1000).toLocaleDateString('de-DE') : '—'],
          ...(renewal ? [['Erneuerung', renewal] as [ReactNode, ReactNode]] : []),
          ['Entsperr-Token', binding.unlock_token ? 'vorhanden' : 'fehlt'],
          ['UDID', <span className="num">{binding.udid}</span>],
        ]}
      />
      {confirm && (
        <ConfirmDialog
          title="MDM-Zertifikat erneuern"
          body={
            <p>
              Das Gerät bekommt ein frisches Registrierungsprofil und holt sich damit ein neues Zertifikat. Am Gerät ist
              nichts zu tun. Sonst passiert das automatisch rechtzeitig vor Ablauf.
            </p>
          }
          confirmLabel="Erneuern"
          busy={renew.isPending}
          onConfirm={() => renew.mutate()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Panel>
  );
}
