import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { formatAgo, formatDateTime } from '../../../format';
import { useNow } from '../../../hooks/useNow';
import {
  IOS_STATUS,
  MDM_INFO_LABELS,
  MDM_SECURITY_INFO_LABELS,
  MDM_STATUS,
  formatMdmInfo,
  mdmStatus,
  securityRows,
} from '../../../mdm';
import { MdmEnrollLink } from '../../../shell/enroll/MdmEnrollLink';
import type { Device, MdmBinding } from '../../../types';
import { ErrorNote, KeyValue, Panel, SkeletonRows, StatusBadge } from '../../../ui';
import { MdmActions } from './MdmActions';
import { MdmApps, MdmCommands, MdmPermissions, MdmProfiles } from './MdmDetails';

function ago(ts: number | null, now: number): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
}

function date(ts: number | null): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{new Date(ts * 1000).toLocaleDateString('de-DE')}</span> : '—';
}

/** Renewal in one phrase: running, failed, done — or nothing to say. */
function renewalText(b: MdmBinding, now: number): ReactNode {
  const r = b.renewal;
  if (!r.started_at) return null;
  if (r.error) return <span className="dv-mdm-bad">fehlgeschlagen: {r.error}</span>;
  if (r.done_at && r.done_at >= r.started_at) return <>erneuert {ago(r.done_at, now)}</>;
  return <>läuft seit {ago(r.started_at, now)}</>;
}

function SecurityPanel({ device, binding, now }: { device: Device; binding: MdmBinding; now: number }) {
  const rows: [ReactNode, ReactNode][] = securityRows(binding.security).map((r) => [
    r.label,
    <span className={r.ok === false ? 'dv-mdm-bad' : undefined}>{r.text}</span>,
  ]);
  for (const [key, label] of MDM_SECURITY_INFO_LABELS) {
    const value = binding.info[key];
    if (value !== undefined) rows.push([label, formatMdmInfo(key, value)]);
  }
  const ios = device.mdm;
  if (ios?.os_version) {
    const st = IOS_STATUS[ios.os_status];
    rows.push([
      'iOS',
      <span className="dv-mdm-ios">
        <span className="num">{ios.os_version}</span>
        <StatusBadge kind={st.kind} label={st.label} size={12} />
        {ios.os_latest && ios.os_status !== 'current' && <span className="muted">neueste: {ios.os_latest}</span>}
      </span>,
    ]);
  }
  return (
    <Panel title="Sicherheit">
      {rows.length > 0 ? (
        <>
          <KeyValue rows={rows} />
          <p className="dv-note">Stand {ago(binding.security_at ?? binding.info_at, now)}.</p>
        </>
      ) : (
        <p className="dv-note">Der Sicherheitsstatus ist angefragt und kommt beim nächsten Kontakt.</p>
      )}
    </Panel>
  );
}

/**
 * MDM state of an iPhone or iPad: enrollment, the commands this role may
 * send, what the phone reported (security, inventory, apps, profiles), the
 * per-device permissions and the history of what was sent.
 */
export function MdmTab({ device, isAdmin, isOperator }: { device: Device; isAdmin: boolean; isOperator: boolean }) {
  const now = useNow();
  const mdm = useQuery({
    queryKey: qk.deviceMdm(device.id),
    queryFn: ({ signal }) => api.deviceMdm(device.id, signal),
  });

  if (mdm.error) return <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />;
  if (!mdm.data) return <SkeletonRows rows={4} />;

  const { binding, needs_reenroll: needsReenroll } = mdm.data;
  const status = mdmStatus(mdm.data);
  const active = binding !== null && binding.checked_out_at === null;
  const info = binding?.info ?? {};
  const infoRows: [ReactNode, ReactNode][] = MDM_INFO_LABELS.flatMap(([key, label]) => {
    const value = info[key];
    return value === undefined ? [] : [[label, <span className="num">{formatMdmInfo(key, value)}</span>]];
  });

  return (
    <div className="dv-grid">
      <Panel title="Registrierung">
        {isAdmin ? (
          <MdmEnrollLink deviceId={device.id} deviceName={device.hostname} />
        ) : (
          <div className="dv-mdm-status">
            <StatusBadge kind={MDM_STATUS[status].kind} label={MDM_STATUS[status].label} />
            <p className="dv-note">{MDM_STATUS[status].text}</p>
          </div>
        )}
        {needsReenroll && (
          <p className="dv-note">
            Mit einem älteren Privat-Profil registriert: Es erlaubt kein Löschen, und nachträglich lässt sich das
            nicht ergänzen. Dafür das Gerät neu registrieren — oder „Löschen“ unter MDM-Befugnisse abschalten.
          </p>
        )}
      </Panel>

      {active && <MdmActions device={device} mdm={mdm.data} isAdmin={isAdmin} isOperator={isOperator} />}

      {binding && <SecurityPanel device={device} binding={binding} now={now} />}

      {binding && (
        <Panel title="Verwaltung">
          <KeyValue
            rows={[
              ['Registriert seit', ago(binding.enrolled_at, now)],
              ['Letzter Kontakt', ago(binding.last_seen_at, now)],
              ...(binding.checked_out_at ? [['Profil entfernt', ago(binding.checked_out_at, now)] as [ReactNode, ReactNode]] : []),
              ['Zertifikat gültig bis', date(binding.identity_expires_at)],
              ...(renewalText(binding, now) ? [['Erneuerung', renewalText(binding, now)] as [ReactNode, ReactNode]] : []),
              ['Entsperr-Token', binding.unlock_token ? 'vorhanden' : 'fehlt'],
              ['Letzte Abfrage', ago(binding.refresh_at, now)],
              ['UDID', <span className="num">{binding.udid}</span>],
            ]}
          />
        </Panel>
      )}

      {binding && (
        <Panel title="Vom Gerät gemeldet">
          {infoRows.length > 0 ? (
            <>
              <KeyValue rows={infoRows} />
              <p className="dv-note">Stand {ago(binding.info_at, now)}.</p>
            </>
          ) : (
            <p className="dv-note">Die Geräteinformationen sind angefragt und kommen beim nächsten Kontakt.</p>
          )}
        </Panel>
      )}

      {binding && <MdmApps binding={binding} denied={mdm.data.denied.includes('apps')} now={now} />}
      {binding && <MdmProfiles binding={binding} now={now} />}
      <MdmPermissions deviceId={device.id} mdm={mdm.data} isAdmin={isAdmin} />
      <MdmCommands mdm={mdm.data} now={now} />
    </div>
  );
}
