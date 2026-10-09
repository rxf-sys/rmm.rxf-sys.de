/** Pieces kept while screens migrate to the new primitives. */

/** A status dot. Colour alone never carries status — pair it with text. */
export function Dot({ color, lg }: { color: string; lg?: boolean }) {
  return <span className={lg ? 'dot dot-lg' : 'dot'} style={{ background: color }} aria-hidden />;
}
