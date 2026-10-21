/**
 * The Vulpexa fox as a graph: the logo (public/favicon.svg) is already a set
 * of nodes joined by edges with faceted fills — a network. The boot sequence
 * draws it the way the product works: devices connect, the picture forms.
 * Coordinates are the logo's own 512 × 512 space.
 */

export type Pt = readonly [number, number];

export const NODES: { p: Pt; r: number; fill: string }[] = [
  { p: [256, 168], r: 12, fill: '#f9cf9b' }, // forehead — the hub
  { p: [215, 247], r: 10, fill: '#f7e8d4' },
  { p: [297, 247], r: 10, fill: '#f7e8d4' },
  { p: [148, 92], r: 13, fill: '#f79441' }, // ear tips
  { p: [364, 92], r: 13, fill: '#f79441' },
  { p: [134, 246], r: 15, fill: '#f5822f' }, // cheeks
  { p: [378, 246], r: 15, fill: '#f5822f' },
  { p: [256, 404], r: 18, fill: '#f8c98e' }, // nose
];

/** Edges in drawing order: from the hub outward, like connections coming up. */
export const EDGES: [Pt, Pt][] = [
  [[256, 168], [215, 247]],
  [[256, 168], [297, 247]],
  [[256, 168], [148, 92]],
  [[256, 168], [364, 92]],
  [[256, 168], [134, 246]],
  [[256, 168], [378, 246]],
  [[148, 92], [134, 246]],
  [[364, 92], [378, 246]],
  [[134, 246], [378, 246]],
  [[215, 247], [256, 404]],
  [[297, 247], [256, 404]],
  [[134, 246], [256, 404]],
  [[378, 246], [256, 404]],
];

export const EDGE_COLOR = '#f08434';

export const FACETS: { points: Pt[]; fill: string; opacity: number }[] = [
  { points: [[256, 168], [215, 247], [297, 247]], fill: '#c2661d', opacity: 0.95 },
  { points: [[148, 92], [256, 168], [134, 246]], fill: '#a44f16', opacity: 0.9 },
  { points: [[364, 92], [256, 168], [378, 246]], fill: '#a44f16', opacity: 0.9 },
  { points: [[134, 246], [215, 247], [256, 404]], fill: '#7e3a10', opacity: 0.88 },
  { points: [[378, 246], [297, 247], [256, 404]], fill: '#7e3a10', opacity: 0.88 },
  { points: [[215, 247], [297, 247], [256, 404]], fill: 'url(#boot-snout)', opacity: 0.95 },
];

export const pointsAttr = (pts: Pt[]): string => pts.map(([x, y]) => `${x},${y}`).join(' ');
