import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { ownershipLabel } from '../../../deviceClass';
import { formatAgo, formatDateTime, osLabel } from '../../../format';
import { useNow } from '../../../hooks/useNow';
import { MDM_INFO_LABELS, MDM_SYNCED_INFO, formatMdmInfo, isAppleMobile } from '../../../mdm';
import type { Device } from '../../../types';
import { ErrorNote, KeyValue, Panel, SkeletonRows, StatusBadge } from '../../../ui';
import type { TabId } from '../deviceTabs';
import { MdmSecurityPanel } from './MdmData';
import { MdmApps, MdmProfiles } from './MdmDetails';

const ago = (ts: number, now?: number) => <span title={formatDateTime(ts)}>{formatAgo(ts, now)}</span>;

/**
 * The overview of a phone or tablet.
 *
 * Kept by hand, everything here was typed in by someone, so the date of the
 * last check sits next to the facts: a card last touched two years ago
 * should not look like one from yesterday. Under MDM the phone reports
 * itself, and its security, inventory, apps and profiles stand here too.
 *
 * Three stacks rather than one grid: the state (management, security, the
 * note), the facts, and what is installed. Each grows on its own, so a long
 * list of facts leaves no hole beside a short card.
 */
export function MobileOverviewTab({
  device,
  isOperator,
  onEdit,
  onGoTab,
}: {
  device: Device;
  isOperator: boolean;
  onEdit: () => void;
  onGoTab: (t: TabId) => void;
}) {
  const now = useNow();
  const managed = device.mdm != null && device.mdm.checked_out_at === null;
  const mdm = useQuery({
    queryKey: qk.deviceMdm(device.id),
    queryFn: ({ signal }) => api.deviceMdm(device.id, signal),
    enabled: managed,
  });
  const binding = managed ? (mdm.data?.binding ?? null) : null;

  const unknown = <span className="muted">unbekannt</span>;
  const rows: [ReactNode, ReactNode][] = [
    ['Typ', osLabel(device.os)],
    ['Version', device.os_version || unknown],
    ['Modell', device.model || unknown],
    ['Besitzverhältnis', ownershipLabel(device) || <span className="muted">nicht gesetzt</span>],
    ['Besitzer', device.owner_label || <span className="muted">—</span>],
  ];
  if (device.serial) rows.push(['Seriennummer', <span className="num">{device.serial}</span>]);
  if (device.imei) rows.push(['IMEI', <span className="num">{device.imei}</span>]);
  rows.push(['Angelegt', ago(device.created_at, now)]);
  // What the phone reports beyond the columns above, in the same list.
  const reported: [ReactNode, ReactNode][] = binding
    ? MDM_INFO_LABELS.flatMap(([key, label]) => {
        const value = binding.info[key];
        const column = MDM_SYNCED_INFO[key];
        return value === undefined || (column && device[column])
          ? []
          : [[label, <span className="num">{formatMdmInfo(key, value)}</span>]];
      })
    : [];

  return (
    <div className="dv-ov">
      <div className={managed ? 'dv-cols tall-b' : 'dv-cols no-c'}>
        <div className="dv-col dv-col-a">
          {managed && device.mdm ? (
            <Panel
              title="Verwaltung"
              actions={
                isAppleMobile(device) && (
                  <button type="button" className="btn btn-sm" onClick={() => onGoTab('mdm')}>
                    MDM-Einstellungen
                  </button>
                )
              }
            >
              <KeyValue
                rows={[
                  [
                    'Erreichbar',
                    device.mdm.reachable ? (
                      <StatusBadge kind="ok" label="ja" plain />
                    ) : (
                      <StatusBadge kind="warn" label="nein" plain />
                    ),
                  ],
                  ['Letzter Kontakt', ago(device.mdm.last_seen_at, now)],
                ]}
              />
              <p className="dv-note">
                Per MDM verwaltet: Systemversion, Seriennummer und IMEI kommen vom Gerät selbst. Befehle stehen im Menü
                oben rechts, Einstellungen im Reiter MDM.
              </p>
            </Panel>
          ) : (
            <Panel title="Pflegestand">
              <KeyValue
                rows={[['Zuletzt geprüft', device.checked_at ? ago(device.checked_at, now) : <span className="muted">nie</span>]]}
              />
              <p className="dv-note">
                Dieses Gerät wird ohne Agent geführt: keine Auslastung, kein Update-Scan, keine Fernbefehle. Alles hier
                ist von Hand gepflegt — der Server lehnt Agent-Befehle an dieses Gerät ab.
              </p>
            </Panel>
          )}
          {managed && mdm.error ? (
            <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />
          ) : managed && mdm.isPending ? (
            <SkeletonRows rows={3} />
          ) : (
            binding && <MdmSecurityPanel device={device} binding={binding} now={now} />
          )}
          {device.notes && (
            <Panel title="Notiz">
              <p className="dv-notes">{device.notes}</p>
            </Panel>
          )}
        </div>

        <div className="dv-col dv-col-b">
          <Panel
            title="Stammdaten"
            meta={binding?.info_at ? <>gemeldet {ago(binding.info_at, now)}</> : undefined}
            actions={
              isOperator && (
                <button type="button" className="btn btn-sm" onClick={onEdit}>
                  Bearbeiten
                </button>
              )
            }
          >
            <KeyValue rows={[...rows, ...reported]} />
            {binding && Object.keys(binding.info).length === 0 && (
              <p className="dv-note">Die Geräteinformationen sind angefragt und kommen beim nächsten Kontakt.</p>
            )}
          </Panel>
        </div>

        {binding && mdm.data && (
          <div className="dv-col dv-col-c">
            <MdmApps binding={binding} denied={mdm.data.denied.includes('apps')} now={now} />
            <MdmProfiles binding={binding} now={now} />
          </div>
        )}
      </div>
    </div>
  );
}
