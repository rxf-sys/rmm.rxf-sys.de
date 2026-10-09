import type { CSSProperties } from 'react';

/** Pulsing placeholder in the shape of what is loading. */
export function Skeleton({ h = 88, w, style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}

/** Placeholder rows for a list or table. Announced once as "Lädt". */
export function SkeletonRows({ rows = 5, h = 44 }: { rows?: number; h?: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Lädt">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h} />
      ))}
    </div>
  );
}
