import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { IconPackage } from '../../icons';
import { ErrorNote, Panel } from '../../ui';

const MIN_CHARS = 2;

/** The query string, but only once typing has paused. */
function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Fleet-wide software search: "auf welchen Geräten ist Java?". */
export function SoftwareSearch() {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const inputId = useId();
  const enabled = query.length >= MIN_CHARS;
  const res = useQuery({
    queryKey: ['inventory-search', query],
    queryFn: ({ signal }) => api.searchInventory(query, signal).then((r) => r.results),
    enabled,
    staleTime: 60_000,
  });
  const results = enabled ? res.data : undefined;

  return (
    <Panel
      title="Software-Suche"
      meta="über die Inventare aller Geräte"
      actions={
        <>
          <label htmlFor={inputId} className="sr-only">
            Software über alle Geräte suchen
          </label>
          <input
            id={inputId}
            type="search"
            className="input sw-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paketname, z. B. openssl"
            autoComplete="off"
          />
        </>
      }
      padded={false}
    >
      {!enabled ? (
        <p className="sw-hint">
          <IconPackage size={14} /> Mindestens zwei Zeichen eingeben — die Suche geht über alle gemeldeten Pakete.
        </p>
      ) : res.error ? (
        <div className="sw-hint">
          <ErrorNote error={res.error} onRetry={() => void res.refetch()} />
        </div>
      ) : results === undefined ? (
        <p className="sw-hint">Sucht …</p>
      ) : results.length === 0 ? (
        <p className="sw-hint">Kein Inventar enthält „{query}".</p>
      ) : (
        <ul className="sw-results" aria-label={`Treffer für ${query}`}>
          {results.map((r, i) => (
            <li key={`${r.device_id}-${r.name}-${i}`}>
              <Link to={`/devices/${r.device_id}?tab=inventory`} className="sw-row">
                <span className="sw-host">{r.hostname}</span>
                <span className="sw-name">{r.name}</span>
                <span className="sw-ver num">{r.version}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
