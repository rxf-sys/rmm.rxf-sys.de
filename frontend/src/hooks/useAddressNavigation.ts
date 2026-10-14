import { useState } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';

/**
 * Calls `onNavigate` during render when someone else moves the address under
 * a page that stays mounted: a link to the same page (the rail, "g p"), Back
 * or Forward. Those navigations push or pop; the page's own writes replace
 * and are left out.
 *
 * Pages keep free text such as the search as component state and only write
 * it to the URL, because React Router applies URL changes in a transition
 * and an input controlled by the URL drops keystrokes. That state has to be
 * taken over from the address on such a navigation — but not on the page's
 * own replaces, or a keystroke's URL update, still in its transition, would
 * undo the keystrokes typed meanwhile.
 */
export function useAddressNavigation(onNavigate: () => void): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    if (navigationType !== NavigationType.Replace) onNavigate();
  }
}
