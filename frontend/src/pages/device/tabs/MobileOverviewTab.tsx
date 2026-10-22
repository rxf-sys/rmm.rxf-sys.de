import type { ReactNode } from 'react';
import { ownershipLabel } from '../../../deviceClass';
import { formatAgo, formatDateTime, osLabel } from '../../../format';
import { isAppleMobile } from '../../../mdm';
import type { Device } from '../../../types';
import { KeyValue, Panel } from '../../../ui';
import type { TabId } from '../deviceTabs';
import { MdmData } from './MdmData';

/**
 * The overview of a phone or tablet.
 *
 * Kept by hand, everything here was typed in by someone, so the date of the
 * last check sits next to the facts: a card last touched two years ago
 * should not look like one from yesterday. Under MDM the phone reports
 * itself, and its security, inventory, apps and profiles stand here too.
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
  const managed = device.mdm != null && device.mdm.checked_out_at === null;
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
  rows.push(['Angelegt', <span title={formatDateTime(device.created_at)}>{formatAgo(device.created_at)}</span>]);

  return (
    <div className="dv-grid">
      <Panel
        title="Stammdaten"
        actions={
          isOperator && (
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              Bearbeiten
            </button>
          )
        }
      >
        <KeyValue rows={rows} />
      </Panel>
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
              ['Erreichbar', device.mdm.reachable ? 'ja' : <span className="dv-mdm-bad">nein</span>],
              [
                'Letzter Kontakt',
                <span title={formatDateTime(device.mdm.last_seen_at)}>{formatAgo(device.mdm.last_seen_at)}</span>,
              ],
            ]}
          />
          <p className="dv-note">
            Per MDM verwaltet: Systemversion, Seriennummer und IMEI kommen vom Gerät selbst. Befehle stehen im Menü oben
            rechts, Einstellungen im Reiter MDM.
          </p>
        </Panel>
      ) : (
        <Panel title="Pflegestand">
          <KeyValue
            rows={[
              [
                'Zuletzt geprüft',
                device.checked_at ? (
                  <span title={formatDateTime(device.checked_at)}>{formatAgo(device.checked_at)}</span>
                ) : (
                  <span className="muted">nie</span>
                ),
              ],
            ]}
          />
          <p className="dv-note">
            Dieses Gerät wird ohne Agent geführt: keine Auslastung, kein Update-Scan, keine Fernbefehle. Alles hier ist
            von Hand gepflegt — der Server lehnt Agent-Befehle an dieses Gerät ab.
          </p>
        </Panel>
      )}
      {managed && <MdmData device={device} />}
      {device.notes && (
        <Panel title="Notiz">
          <p className="dv-notes">{device.notes}</p>
        </Panel>
      )}
    </div>
  );
}
