import type { ReactNode } from 'react';
import { ownershipLabel } from '../../../deviceClass';
import { formatAgo, formatDateTime, osLabel } from '../../../format';
import type { Device } from '../../../types';
import { KeyValue, Panel } from '../../../ui';

/**
 * The overview of a device that never reports anything.
 *
 * No load, no network, no software — everything here was typed in by
 * someone. So the date of the last check sits next to the facts: a card
 * last touched two years ago should not look like one from yesterday.
 */
export function MobileOverviewTab({ device, isOperator, onEdit }: { device: Device; isOperator: boolean; onEdit: () => void }) {
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
          {device.mdm && !device.mdm.checked_out_at
            ? 'Dieses Gerät wird per MDM verwaltet: Systemversion, Seriennummer und IMEI kommen vom Gerät selbst. Befehle und Sicherheitsstatus stehen im Reiter MDM.'
            : 'Dieses Gerät wird ohne Agent geführt: keine Auslastung, kein Update-Scan, keine Fernbefehle. Alles hier ist von Hand gepflegt — der Server lehnt Agent-Befehle an dieses Gerät ab.'}
        </p>
      </Panel>
      {device.notes && (
        <Panel title="Notiz">
          <p className="dv-notes">{device.notes}</p>
        </Panel>
      )}
    </div>
  );
}
