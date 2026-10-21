import { Link } from 'react-router-dom';
import { deviceStatusKind } from '../../deviceStatus';
import { PAGE_PATH, devicePath } from '../../routes';
import type { Device } from '../../types';
import { StatusBadge, type StatusKind } from '../../ui';

type GroupKind = 'danger' | 'warn' | 'off' | 'ok' | 'noagent';

const GROUPS: { kind: GroupKind; label: string; filter?: string }[] = [
  { kind: 'danger', label: 'Kritisch', filter: 'probleme' },
  { kind: 'warn', label: 'Warnung', filter: 'probleme' },
  { kind: 'off', label: 'Offline', filter: 'offline' },
  { kind: 'ok', label: 'OK', filter: 'ok' },
  { kind: 'noagent', label: 'Ohne Agent', filter: 'mobil' },
];

/** Beyond this many cells per group the rest is a count, not more DOM. */
const CELL_LIMIT = 240;
const fmt = new Intl.NumberFormat('de-DE');

/** Up to 60 devices each cell is a comfortable touch target: 20 px plus the
 *  4 px gap gives the 24 px spacing WCAG 2.5.8 asks for. Denser maps trade
 *  that for overview; the group label links to the same devices as a list. */
function cellSize(total: number): number {
  if (total <= 60) return 20;
  if (total <= 300) return 12;
  return 8;
}

/**
 * Das Lagebild: every device is one cell, grouped by state and labelled, so
 * the state of the fleet reads at a glance — with ten devices as with ten
 * thousand. The group label carries the word, the cell shape carries the
 * rest (dashed: not reporting, outlined: no agent), colour only supports it.
 */
export function FleetMap({ devices }: { devices: Device[] }) {
  const byKind = new Map<GroupKind, Device[]>();
  for (const d of devices) {
    const k = deviceStatusKind(d);
    const list = byKind.get(k);
    if (list) list.push(d);
    else byKind.set(k, [d]);
  }
  const size = cellSize(devices.length);

  return (
    <div className="fleetmap" style={{ ['--cell' as string]: `${size}px` }}>
      {GROUPS.map(({ kind, label, filter }) => {
        const list = byKind.get(kind) ?? [];
        if (list.length === 0) return null;
        const shown = list.slice(0, CELL_LIMIT);
        const rest = list.length - shown.length;
        return (
          <div key={kind} className="fleetmap-row">
            <Link
              to={filter ? `${PAGE_PATH.devices}?filter=${filter}` : PAGE_PATH.devices}
              className="fleetmap-label"
              aria-label={`${label}: ${list.length} Geräte, in der Geräteliste zeigen`}
            >
              <StatusBadge kind={kind as StatusKind} label={`${label} · ${fmt.format(list.length)}`} />
            </Link>
            <ul className="fleetmap-cells" aria-label={`${label}: Geräte`}>
              {shown.map((d) => (
                <li key={d.id}>
                  <Link
                    to={devicePath(d.id)}
                    className={`fleetmap-cell ${kind}`}
                    title={`${d.hostname} · ${label}`}
                    aria-label={`${d.hostname}, ${label}`}
                  />
                </li>
              ))}
              {rest > 0 && (
                <li className="fleetmap-rest">
                  <Link to={filter ? `${PAGE_PATH.devices}?filter=${filter}` : PAGE_PATH.devices}>
                    +{fmt.format(rest)} weitere
                  </Link>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
