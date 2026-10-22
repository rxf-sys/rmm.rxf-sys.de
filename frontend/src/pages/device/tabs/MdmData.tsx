import type { ReactNode } from 'react';
import { formatAgo, formatDateTime } from '../../../format';
import { IOS_STATUS, MDM_SECURITY_INFO_LABELS, formatMdmInfo, securityRows } from '../../../mdm';
import type { Device, MdmBinding } from '../../../types';
import { KeyValue, Panel, StatusBadge } from '../../../ui';

function mdmAgo(ts: number | null, now: number): ReactNode {
  return ts ? <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span> : <span className="muted">nie</span>;
}

/** What the phone says about its protection: passcode, encryption, Find My,
 *  backup and how current iOS is. A failing check reads as a warning word
 *  with its icon, not as coloured text. */
export function MdmSecurityPanel({ device, binding, now }: { device: Device; binding: MdmBinding; now: number }) {
  const rows: [ReactNode, ReactNode][] = securityRows(binding.security).map((r) => [
    r.label,
    r.ok === null ? <span className="muted">{r.text}</span> : <StatusBadge kind={r.ok ? 'ok' : 'warn'} label={r.text} plain />,
  ]);
  for (const [key, label] of MDM_SECURITY_INFO_LABELS) {
    const value = binding.info[key];
    if (value === undefined) continue;
    rows.push([label, key === 'LastCloudBackupDate' && typeof value === 'number' ? mdmAgo(value, now) : formatMdmInfo(key, value)]);
  }
  const ios = device.mdm;
  if (ios?.os_version) {
    const st = IOS_STATUS[ios.os_status];
    rows.push([
      'iOS-Stand',
      <span className="dv-mdm-ios">
        <StatusBadge kind={st.kind} label={st.label} plain />
        {ios.os_latest && ios.os_status !== 'current' && <span className="muted">neueste: {ios.os_latest}</span>}
      </span>,
    ]);
  }
  return (
    <Panel title="Sicherheit" meta={rows.length > 0 ? <>Stand {mdmAgo(binding.security_at ?? binding.info_at, now)}</> : undefined}>
      {rows.length > 0 ? (
        <KeyValue rows={rows} />
      ) : (
        <p className="dv-note">Der Sicherheitsstatus ist angefragt und kommt beim nächsten Kontakt.</p>
      )}
    </Panel>
  );
}
