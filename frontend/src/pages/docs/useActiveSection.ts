import { useSyncExternalStore } from 'react';
import { READING_LINE, SECTION_IDS, pickActiveSection, type SectionId } from './docSections';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('scroll', onChange, { passive: true });
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

/** Reads the section positions straight from the layout. Six rectangles per
 *  scroll event are cheap, and React only re-renders when the id changes. */
function readActive(): SectionId {
  const positions = SECTION_IDS.flatMap((id) => {
    const el = document.getElementById(id);
    return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
  });
  const doc = document.documentElement;
  // A page that does not scroll has no end to reach.
  const scrollable = doc.scrollHeight > window.innerHeight + 1;
  const atEnd = scrollable && window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
  return pickActiveSection(positions, READING_LINE, atEnd);
}

const first = (): SectionId => SECTION_IDS[0]!;

/** The section being read right now, for `aria-current` in the contents. */
export function useActiveSection(): SectionId {
  return useSyncExternalStore(subscribe, readActive, first);
}
