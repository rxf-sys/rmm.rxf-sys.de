import { useSyncExternalStore } from 'react';

/** Does a media query match right now? Re-renders when it starts or stops
 *  matching. Without `matchMedia` (tests, very old browsers) it never
 *  matches, which means the desktop layout. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
