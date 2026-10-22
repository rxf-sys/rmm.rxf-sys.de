import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { formatAgo, formatDateTime } from '../../../format';
import { useNow } from '../../../hooks/useNow';
import { IOS_STATUS, MDM_INFO_LABELS, MDM_SECURITY_INFO_LABELS, formatMdmInfo, securityRows } from '../../../mdm';
import type { Device, MdmBinding } from '../../../types';
import { ErrorNote, KeyValue, Panel, SkeletonRows, StatusBadge } from '../../../ui';
import { MdmApps, MdmProfiles } from './MdmDetails';

function ago(ts: number | null, now: number): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
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
 * Everything a phone under MDM reports about itself, for the overview:
 * security, inventory, apps, profiles and certificates. Settings that change
 * the phone live in the MDM tab; the commands in the header menu.
 */
export function MdmData({ device }: { device: Device }) {
  const now = useNow();
  const mdm = useQuery({
    queryKey: qk.deviceMdm(device.id),
    queryFn: ({ signal }) => api.deviceMdm(device.id, signal),
  });
  if (mdm.error) return <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />;
  if (!mdm.data) return <SkeletonRows rows={3} />;
  const binding = mdm.data.binding;
  if (!binding) return null;

  const infoRows: [ReactNode, ReactNode][] = MDM_INFO_LABELS.flatMap(([key, label]) => {
    const value = binding.info[key];
    return value === undefined ? [] : [[label, <span className="num">{formatMdmInfo(key, value)}</span>]];
  });

  return (
    <>
      <SecurityPanel device={device} binding={binding} now={now} />
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
      <MdmApps binding={binding} denied={mdm.data.denied.includes('apps')} now={now} />
      <MdmProfiles binding={binding} now={now} />
    </>
  );
}
