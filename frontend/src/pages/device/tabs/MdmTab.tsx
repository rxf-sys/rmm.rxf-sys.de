import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { formatAgo, formatDateTime } from '../../../format';
import { MDM_INFO_LABELS, MDM_STATUS, formatMdmInfo, hasEraseRight, mdmStatus } from '../../../mdm';
import { MdmEnrollLink } from '../../../shell/enroll/MdmEnrollLink';
import type { Device } from '../../../types';
import { ErrorNote, KeyValue, Panel, SkeletonRows, StatusBadge } from '../../../ui';

function ago(ts: number | null): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts)}</span> : <span className="muted">nie</span>;
}

/**
 * MDM state of an iPhone or iPad: how far the enrollment is, what the phone
 * reported, and — for admins — the link that enrolls it.
 *
 * Commands (lock, inventory refresh, …) follow in their own step; this tab
 * only shows what the enrollment brought in.
 */
export function MdmTab({ device, isAdmin }: { device: Device; isAdmin: boolean }) {
  const mdm = useQuery({
    queryKey: qk.deviceMdm(device.id),
    queryFn: ({ signal }) => api.deviceMdm(device.id, signal),
  });

  if (mdm.error) return <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />;
  if (!mdm.data) return <SkeletonRows rows={4} />;

  const { binding, needs_reenroll: needsReenroll } = mdm.data;
  const status = mdmStatus(mdm.data);
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
            Als Privatgerät registriert, jetzt als Firmengerät geführt: Das Profil auf dem Gerät erlaubt kein
            Komplett-Löschen. Dafür das Gerät neu registrieren.
          </p>
        )}
      </Panel>

      {binding && (
        <Panel title="Verwaltung">
          <KeyValue
            rows={[
              ['Registriert seit', ago(binding.enrolled_at)],
              ['Letzter Kontakt', ago(binding.last_seen_at)],
              ...(binding.checked_out_at ? [['Profil entfernt', ago(binding.checked_out_at)] as [ReactNode, ReactNode]] : []),
              ['Komplett-Löschen', hasEraseRight(binding.access_rights) ? 'im Profil erlaubt' : 'im Profil ausgeschlossen'],
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
              <p className="dv-note">Stand {ago(binding.info_at)}.</p>
            </>
          ) : (
            <p className="dv-note">Die Geräteinformationen sind angefragt und kommen beim nächsten Kontakt.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
