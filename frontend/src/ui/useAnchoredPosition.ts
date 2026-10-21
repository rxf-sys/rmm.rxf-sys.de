import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

const GAP = 6;
const MARGIN = 8;

/**
 * Fixed-position coordinates for a floating panel next to its trigger.
 * Fixed positioning lets the panel escape scroll containers and
 * `overflow: hidden` ancestors; the panel flips to the other side when it
 * would leave the viewport and is clamped to an 8 px margin.
 */
export function useAnchoredPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  placement: Placement,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!t || !p) return;
      const pw = p.offsetWidth;
      const ph = p.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = placement.startsWith('bottom') ? t.bottom + GAP : t.top - ph - GAP;
      const below = placement.startsWith('bottom');
      if (below && top + ph > vh - MARGIN && t.top - ph - GAP > MARGIN) top = t.top - ph - GAP;
      if (!below && top < MARGIN && t.bottom + GAP + ph < vh - MARGIN) top = t.bottom + GAP;
      let left = placement.endsWith('end') ? t.right - pw : t.left;
      left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN));
      const fromAbove = top < t.top;
      setStyle({
        position: 'fixed',
        top: Math.max(MARGIN, top),
        left,
        transformOrigin: `${placement.endsWith('end') ? 'right' : 'left'} ${fromAbove ? 'bottom' : 'top'}`,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement, triggerRef, panelRef]);

  return style;
}
