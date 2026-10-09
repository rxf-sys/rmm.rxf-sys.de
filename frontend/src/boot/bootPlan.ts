/** Pure planning for the boot sequence: mode, dot field, dot colours. */

export type BootMode = 'full' | 'quick' | 'still';

export interface FleetMix {
  ok: number;
  warn: number;
  danger: number;
  off: number;
}

const SESSION_KEY = 'vulpexa-boot-seen';

/**
 * 'still' with reduced motion or without the Web Animations API, 'full' the
 * first time in a browser session, 'quick' after that — a daily tool should
 * not make anyone sit through the same show twice.
 */
let decided: BootMode | null = null;

export function bootMode(): BootMode {
  // Decided once per page load: React may call the caller twice (StrictMode),
  // and the second call would already see the session flag.
  if (decided) return decided;
  decided = decideMode();
  return decided;
}

function decideMode(): BootMode {
  if (typeof window === 'undefined') return 'still';
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'still';
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return 'still';
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return 'quick';
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    return 'quick';
  }
  return 'full';
}

export interface Dot {
  x: number;
  y: number;
  r: number;
}

/** Deterministic pseudo-random sequence, so the field looks the same on
 *  every visit instead of reshuffling. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * The field of dots around the fox: a loose ring that keeps the centre free
 * for the logo and the wordmark. Count scales with the screen.
 */
export function fieldDots(width: number, height: number, seed = 42): Dot[] {
  const r = rng(seed);
  const count = Math.round(Math.min(140, Math.max(48, (width * height) / 9000)));
  const cx = width / 2;
  const cy = height / 2;
  const inner = Math.min(width, height) * 0.24;
  const outerX = width * 0.48;
  const outerY = height * 0.46;
  const dots: Dot[] = [];
  let guard = 0;
  while (dots.length < count && guard < count * 20) {
    guard += 1;
    const a = r() * Math.PI * 2;
    const d = 0.25 + r() * 0.75;
    const x = cx + Math.cos(a) * outerX * d;
    const y = cy + Math.sin(a) * outerY * d;
    if (Math.hypot(x - cx, (y - cy) * 1.2) < inner) continue;
    dots.push({ x, y, r: 1.4 + r() * 1.6 });
  }
  return dots;
}

/**
 * Colours for the ping: the field shows the fleet's actual mix. Every state
 * that occurs gets at least one dot, so a single critical device is never
 * rounded away.
 */
export function assignDotStates(n: number, mix: FleetMix): (keyof FleetMix)[] {
  const keys: (keyof FleetMix)[] = ['danger', 'warn', 'off', 'ok'];
  const total = keys.reduce((s, k) => s + mix[k], 0);
  if (n <= 0) return [];
  if (total === 0) return Array.from({ length: n }, () => 'ok' as const);
  const counts = keys.map((k) => (mix[k] > 0 ? Math.max(1, Math.round((mix[k] / total) * n)) : 0));
  let sum = counts.reduce((a, b) => a + b, 0);
  // Fix rounding on the largest group so the counts add up to n exactly.
  while (sum !== n) {
    const i = counts.indexOf(Math.max(...counts));
    counts[i] = (counts[i] ?? 0) + (sum > n ? -1 : 1);
    sum += sum > n ? -1 : 1;
  }
  const out: (keyof FleetMix)[] = [];
  keys.forEach((k, i) => {
    for (let j = 0; j < (counts[i] ?? 0); j += 1) out.push(k);
  });
  // Spread the states over the field instead of clustering them.
  const r = rng(7);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
