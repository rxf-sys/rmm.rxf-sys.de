import { useId, useState, type ReactNode } from 'react';
import { formatAgo, formatBytes, formatDateTime } from '../../../format';
import { IconPackage, IconSearch } from '../../../icons';
import type { DeviceDetail } from '../../../types';
import { EmptyState, KeyValue, Panel } from '../../../ui';
import { readHardware, readSoftware } from '../inventory';

/** Rows rendered at most; a filter narrows the rest. */
const LIMIT = 500;

function Reported({ at }: { at: number | undefined }) {
  if (!at) return <>noch nichts gemeldet</>;
  return <span title={formatDateTime(at)}>gemeldet {formatAgo(at)}</span>;
}

/** Hardware facts and the installed software, as the agent reported them. */
export function InventoryTab({ detail }: { detail: DeviceDetail }) {
  const [q, setQ] = useState('');
  const filterId = useId();
  const hw = readHardware(detail.inventory.hardware?.data);
  const sw = readSoftware(detail.inventory.software?.data) ?? [];

  if (!detail.inventory.hardware && !detail.inventory.software) {
    return (
      <EmptyState icon={<IconPackage size={22} />} title="Noch kein Inventar">
        Der Agent erhebt es beim nächsten Verbinden — bei einem frisch aufgenommenen Gerät dauert das eine Meldung.
      </EmptyState>
    );
  }

  const rows: [ReactNode, ReactNode][] = [
    ['Plattform', `${hw.platform} ${hw.platform_version}`.trim() || '—'],
    ['Kernel', hw.kernel_version || '—'],
    ['Prozessor', hw.cpu_model || '—'],
    ['Threads', hw.cpu_threads !== undefined ? String(hw.cpu_threads) : '—'],
    ['Arbeitsspeicher', hw.mem_total_b !== undefined ? formatBytes(hw.mem_total_b) : '—'],
  ];
  const needle = q.trim().toLowerCase();
  const shown = needle ? sw.filter((s) => s.name.toLowerCase().includes(needle)) : sw;
  const sorted = [...shown].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

  return (
    <div className="dv-inv">
      <Panel title="Hardware" meta={<Reported at={detail.inventory.hardware?.updated_at} />}>
        <KeyValue rows={rows} />
      </Panel>
      <Panel
        title="Software"
        meta={
          <>
            {needle ? `${shown.length.toLocaleString('de-DE')} von ${sw.length.toLocaleString('de-DE')}` : `${sw.length.toLocaleString('de-DE')} Pakete`} ·{' '}
            <Reported at={detail.inventory.software?.updated_at} />
          </>
        }
        padded={false}
        actions={
          <div className="dv-filter">
            <IconSearch size={14} />
            <label htmlFor={filterId} className="sr-only">
              Software filtern
            </label>
            <input id={filterId} type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtern …" />
          </div>
        }
      >
        {sorted.length === 0 ? (
          <p className="dv-pad muted">{sw.length === 0 ? 'Der Agent hat keine Softwareliste geliefert.' : `Kein Paket enthält „${q.trim()}".`}</p>
        ) : (
          <div className="dv-scroll">
            <table className="dv-table">
              <thead>
                <tr>
                  <th scope="col">Paket</th>
                  <th scope="col" className="dv-r">
                    Version
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, LIMIT).map((s, i) => (
                  <tr key={`${s.name}-${i}`}>
                    <td>{s.name}</td>
                    <td className="dv-r num muted">{s.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length > LIMIT && (
              // Say so instead of cutting the list off silently.
              <p className="dv-pad muted">
                {(sorted.length - LIMIT).toLocaleString('de-DE')} weitere Pakete nicht angezeigt — Filter eingrenzen.
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
