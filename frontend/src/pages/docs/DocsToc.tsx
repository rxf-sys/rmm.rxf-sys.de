import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown, IconList } from '../../icons';
import { SECTIONS, sectionById, type SectionId } from './docSections';

function Links({ active, onPick }: { active: SectionId; onPick?: () => void }) {
  return SECTIONS.map((s) => (
    <li key={s.id}>
      <a href={`#${s.id}`} className="dc-toc-link" aria-current={s.id === active ? 'location' : undefined} onClick={onPick}>
        {s.title}
      </a>
    </li>
  ));
}

/**
 * Contents with plain anchor links, so the address, the back button and a
 * shared link all work like on any web page. Wide screens get a sticky
 * column; narrow ones a bar under the top bar that names the current
 * section and opens the list over the text, without pushing it down.
 */
export function DocsToc({ active, compact }: { active: SectionId; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!compact)
    return (
      <nav className="dc-toc" aria-labelledby={labelId}>
        <p id={labelId} className="dc-toc-label">
          Inhalt
        </p>
        <ol className="dc-toc-list">
          <Links active={active} />
        </ol>
      </nav>
    );

  return (
    <nav ref={navRef} className="dc-toc-bar" aria-label="Inhalt">
      <button
        ref={toggleRef}
        type="button"
        className="dc-toc-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <IconList size={16} />
        <span className="dc-toc-toggle-label">Inhalt</span>
        <span className="dc-toc-current">{sectionById(active).title}</span>
        <span className={open ? 'dc-toc-chevron is-open' : 'dc-toc-chevron'}>
          <IconChevronDown size={16} />
        </span>
      </button>
      {/* Hidden rather than unmounted, so aria-controls always names an
          element and the picked link stays in the page while the browser
          follows it. */}
      <ol id={listId} className="dc-toc-list dc-toc-drop" hidden={!open}>
        <Links active={active} onPick={() => setOpen(false)} />
      </ol>
    </nav>
  );
}
