import type { ReactNode } from 'react';

/** Label/value pairs as a definition list. Labels size to the longest one,
 *  so "Sicherheitsupdates" never runs into its value. */
export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv-list">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
