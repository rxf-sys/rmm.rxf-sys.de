import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EDGES, EDGE_COLOR, FACETS, NODES, pointsAttr } from './foxGeometry';
import { assignDotStates, bootMode, fieldDots, type BootMode, type FleetMix } from './bootPlan';

export interface BootSummary {
  devices: number;
  online: number;
  attention: number;
  mix: FleetMix;
}

interface Props {
  /** Auth resolved and, when signed in, the first fleet load finished. */
  ready: boolean;
  /** null while auth is still unknown. */
  signedIn: boolean | null;
  summary: BootSummary | null;
  error: string | null;
  onDone: () => void;
}

const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
const DOT_STATE_COLOR: Record<keyof FleetMix, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  off: 'var(--shell-tx-2)',
};
const fmt = new Intl.NumberFormat('de-DE');

function statusText(p: Props): string {
  if (p.signedIn === null) return 'Starte …';
  if (!p.ready) return 'Verbinde mit der Flotte …';
  if (p.error) return 'Server nicht erreichbar — das Dashboard zeigt den letzten Stand.';
  if (!p.signedIn) return 'Bereit zur Anmeldung';
  const s = p.summary;
  if (!s || s.devices === 0) return 'Bereit — noch keine Geräte angebunden';
  const parts = [`${fmt.format(s.devices)} Geräte`, `${fmt.format(s.online)} online`];
  if (s.attention > 0) parts.push(`${fmt.format(s.attention)} brauchen Aufmerksamkeit`);
  return parts.join(' · ');
}

/** The visible element the fox flies to: the rail logo, the phone top bar
 *  logo or the login logo — whichever is on screen. */
function findTarget(): DOMRect | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-boot-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

/**
 * Startup sequence. The fox is assembled from the fleet: field dots (devices)
 * fly to the logo's nodes, the connections draw like agents coming online,
 * the facets fill. Once auth and the first fleet load are really done, a
 * ping runs through the field in the fleet's actual status colours and the
 * fox flies to its place in the navigation — the dashboard is ready.
 *
 * Full length once per browser session, a short version afterwards, a plain
 * crossfade with reduced motion. Any click or key skips ahead.
 */
export function BootSequence(props: Props) {
  const { ready, onDone } = props;
  const mode: BootMode = useMemo(() => bootMode(), []);
  const [introDone, setIntroDone] = useState(mode === 'still');
  const [skipped, setSkipped] = useState(false);
  const exiting = useRef(false);
  const running = useRef<Animation[]>([]);

  const stageRef = useRef<HTMLDivElement>(null);
  const foxWrapRef = useRef<HTMLDivElement>(null);
  const foxRef = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<SVGSVGElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<SVGRectElement>(null);

  const dots = useMemo(() => fieldDots(typeof window === 'undefined' ? 1280 : window.innerWidth, typeof window === 'undefined' ? 800 : window.innerHeight), []);

  const track = (a: Animation | undefined) => {
    if (a) running.current.push(a);
    return a;
  };

  // ---- Intro: assemble the fox ------------------------------------------
  useLayoutEffect(() => {
    if (mode === 'still') return;
    const fox = foxRef.current;
    const field = fieldRef.current;
    if (!fox || typeof fox.animate !== 'function') {
      setIntroDone(true);
      return;
    }
    const full = mode === 'full';
    const foxBox = fox.getBoundingClientRect();
    const unit = 512 / Math.max(1, foxBox.width);
    const anims: Promise<unknown>[] = [];

    if (full && field) {
      field.querySelectorAll<SVGCircleElement>('circle').forEach((c, i) => {
        track(
          c.animate([{ opacity: 0 }, { opacity: 0.35 }], {
            duration: 600,
            delay: (i * 37) % 420,
            easing: 'ease-out',
            fill: 'both',
          }),
        );
      });
    }

    fox.querySelectorAll<SVGCircleElement>('.boot-node').forEach((n, i) => {
      // Fly in from one of the field dots — a device joining the picture.
      const from = dots[(i * 7 + 3) % dots.length];
      const [nx, ny] = NODES[i]!.p;
      const sx = foxBox.left + (nx / 512) * foxBox.width;
      const sy = foxBox.top + (ny / 512) * foxBox.height;
      const dx = full && from ? (from.x - sx) * unit : 0;
      const dy = full && from ? (from.y - sy) * unit : 0;
      const a = track(
        n.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${full ? 0.6 : 0.9})`, opacity: 0 },
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          ],
          { duration: full ? 620 : 220, delay: full ? 150 + i * 38 : i * 12, easing: EXPO_OUT, fill: 'both' },
        ),
      );
      if (a) anims.push(a.finished);
    });

    fox.querySelectorAll<SVGLineElement>('.boot-edge').forEach((e, i) => {
      const a = track(
        e.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: full ? 420 : 200,
          delay: full ? 560 + i * 32 : 80 + i * 8,
          easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
          fill: 'both',
        }),
      );
      if (a) anims.push(a.finished);
    });

    fox.querySelectorAll<SVGPolygonElement>('.boot-facet').forEach((f, i) => {
      const target = Number(f.dataset.opacity ?? 1);
      const a = track(
        f.animate(
          [
            { opacity: 0, transform: 'scale(0.9)' },
            { opacity: target, transform: 'scale(1)' },
          ],
          { duration: full ? 420 : 200, delay: full ? 880 + i * 55 : 160 + i * 15, easing: EXPO_OUT, fill: 'both' },
        ),
      );
      if (a) anims.push(a.finished);
    });

    const word = wordRef.current;
    if (word) {
      const a = track(
        word.animate(
          [
            { opacity: 0, letterSpacing: '0.32em', transform: 'translateY(6px)' },
            { opacity: 1, letterSpacing: '-0.02em', transform: 'none' },
          ],
          { duration: full ? 620 : 220, delay: full ? 980 : 120, easing: EXPO_OUT, fill: 'both' },
        ),
      );
      if (a) anims.push(a.finished);
    }

    let cancelled = false;
    Promise.all(anims)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setIntroDone(true);
      });
    const started = running.current;
    return () => {
      cancelled = true;
      // StrictMode runs this effect twice in development; the first set of
      // animations must not keep playing underneath the second.
      started.forEach((a) => a.cancel());
      running.current = [];
    };
  }, [mode, dots]);

  // ---- Waiting: the hub breathes until the data is there ------------------
  useEffect(() => {
    if (!introDone || ready || mode === 'still') return;
    const hub = foxRef.current?.querySelector<SVGCircleElement>('.boot-node');
    const a = hub?.animate?.([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], {
      duration: 1200,
      iterations: Infinity,
      easing: 'ease-in-out',
    });
    return () => a?.cancel();
  }, [introDone, ready, mode]);

  // ---- Ping and exit --------------------------------------------------------
  const exit = useCallback(
    (withPing: boolean) => {
      if (exiting.current) return;
      exiting.current = true;
      const stage = stageRef.current;
      const wrap = foxWrapRef.current;
      if (!stage || !wrap || typeof stage.animate !== 'function' || mode === 'still') {
        const a = stage?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
        if (a) void a.finished.then(onDone, onDone);
        else onDone();
        return;
      }
      running.current.forEach((a) => a.finish());
      const full = mode === 'full';
      let pingMs = 0;
      const field = fieldRef.current;
      if (withPing && field && full) {
        const mix = props.summary?.mix ?? { ok: 1, warn: 0, danger: 0, off: 0 };
        const states = assignDotStates(dots.length, mix);
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const maxD = Math.hypot(cx, cy);
        field.querySelectorAll<SVGCircleElement>('circle').forEach((c, i) => {
          const d = Math.hypot((dots[i]?.x ?? cx) - cx, (dots[i]?.y ?? cy) - cy) / maxD;
          const state = states[i] ?? 'ok';
          c.style.fill = DOT_STATE_COLOR[state];
          c.animate(
            [
              { opacity: 0.35, transform: 'scale(1)' },
              { opacity: 1, transform: 'scale(2.2)', offset: 0.35 },
              { opacity: 0.85, transform: 'scale(1)' },
            ],
            { duration: 520, delay: d * 380, easing: 'ease-out', fill: 'forwards' },
          );
        });
        pingMs = 700;
      }

      window.setTimeout(() => {
        const from = wrap.getBoundingClientRect();
        const to = findTarget();
        const tile = tileRef.current;
        const dur = full ? 560 : 380;
        if (tile) tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: IN_OUT, fill: 'forwards' });
        const word = wordRef.current;
        word?.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 160, fill: 'forwards' });
        const bg = stage.querySelector<HTMLElement>('.boot-bg');
        const fade = { duration: dur * 0.8, delay: dur * 0.2, easing: 'ease-out', fill: 'forwards' as const };
        bg?.animate([{ opacity: 1 }, { opacity: 0 }], fade);
        fieldRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], fade);
        stage.querySelector('.boot-status')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
        const flight = to
          ? (() => {
              const dx = to.left + to.width / 2 - (from.left + from.width / 2);
              const dy = to.top + to.height / 2 - (from.top + from.height / 2);
              const s = to.width / from.width;
              return wrap.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], {
                duration: dur,
                easing: IN_OUT,
                fill: 'forwards',
              });
            })()
          : wrap.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.9)' }], { duration: dur, fill: 'forwards' });
        // The fox lands on the logo it was drawn from, then hands over.
        void flight.finished
          .then(() => wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished)
          .then(onDone, onDone);
      }, pingMs);
    },
    [dots, mode, onDone, props.summary],
  );

  useEffect(() => {
    if (ready && (introDone || skipped)) exit(!skipped);
  }, [ready, introDone, skipped, exit]);

  // Any key, click or tap skips ahead (the sequence still waits for real data).
  useEffect(() => {
    const skip = () => {
      running.current.forEach((a) => a.finish());
      setSkipped(true);
      setIntroDone(true);
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, []);

  const text = statusText(props);

  return (
    <div ref={stageRef} className={`boot boot-${mode}`}>
      <div className="boot-bg" aria-hidden />
      {mode === 'full' && (
        <svg ref={fieldRef} className="boot-field" aria-hidden width="100%" height="100%">
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} />
          ))}
        </svg>
      )}
      <div className="boot-center">
        <div ref={foxWrapRef} className="boot-fox-wrap">
          <svg ref={foxRef} viewBox="0 0 512 512" className="boot-fox" aria-hidden>
            <defs>
              <linearGradient id="boot-snout" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f6c68e" />
                <stop offset="1" stopColor="#e8913f" />
              </linearGradient>
              <linearGradient id="boot-tile" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#181b27" />
                <stop offset="1" stopColor="#0c0e15" />
              </linearGradient>
            </defs>
            <rect ref={tileRef} width="512" height="512" rx="115" fill="url(#boot-tile)" opacity="0" />
            {FACETS.map((f, i) => (
              <polygon
                key={i}
                className="boot-facet"
                points={pointsAttr(f.points)}
                fill={f.fill}
                data-opacity={f.opacity}
                opacity={mode === 'still' ? f.opacity : 0}
              />
            ))}
            <g stroke={EDGE_COLOR} strokeWidth={9} strokeLinecap="round">
              {EDGES.map(([a, b], i) => (
                <line
                  key={i}
                  className="boot-edge"
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={mode === 'still' ? 0 : 1}
                />
              ))}
            </g>
            {NODES.map((n, i) => (
              <circle
                key={i}
                className="boot-node"
                cx={n.p[0]}
                cy={n.p[1]}
                r={n.r}
                fill={n.fill}
                opacity={mode === 'still' ? 1 : 0}
              />
            ))}
          </svg>
        </div>
        <div ref={wordRef} className="boot-word" style={mode === 'still' ? undefined : { opacity: 0 }}>
          Vulpexa
        </div>
        <p className="boot-status" role="status" aria-live="polite">
          {text}
        </p>
      </div>
      {!ready && (
        <button
          type="button"
          className="boot-skip"
          onClick={() => {
            running.current.forEach((a) => a.finish());
            setSkipped(true);
            setIntroDone(true);
          }}
        >
          Animation überspringen
        </button>
      )}
    </div>
  );
}
