import { deviceLabel } from '../../deviceLabel';
import type { Device } from '../../types';

const fmt = new Intl.NumberFormat('de-DE');

/** Every device a bulk action reaches, by name. A count alone does not say
 *  whether the server you meant to leave out is in there; past six names the
 *  list folds away so the dialog stays readable. */
export function DeviceNames({ devices, dups }: { devices: Device[]; dups: Set<string> }) {
  if (devices.length === 0) return null;
  const list = <p className="bulk-names">{devices.map((d) => deviceLabel(d, dups)).join(', ')}</p>;
  if (devices.length <= 6) return list;
  return (
    <details className="bulk-names-more">
      <summary>Alle {fmt.format(devices.length)} Geräte anzeigen</summary>
      {list}
    </details>
  );
}
