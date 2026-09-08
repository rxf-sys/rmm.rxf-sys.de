/** Small presentational pieces reused across the screens. Status helpers
 * live in deviceStatus.ts. */

/** A glowing status dot. */
export function Dot({ color, lg }: { color: string; lg?: boolean }) {
  return (
    <span
      className={lg ? 'dot dot-lg' : 'dot'}
      style={{ background: color, boxShadow: `0 0 ${lg ? 9 : 8}px ${color}` }}
    />
  );
}

/** Pulsing skeleton block. */
export function Skeleton({ h = 88, style }: { h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, ...style }} />;
}
