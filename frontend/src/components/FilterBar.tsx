import { useRef } from 'react';

export interface FilterOption<T extends string> {
  id: T;
  label: string;
  /** Rendered as a small pill after the label. Omit to show no count. */
  count?: number;
  /** Tints the count pill — used for "In Ordnung"/"Probleme"/"Offline". */
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
  /** Optional leading glyph (OS logo, icon). */
  icon?: React.ReactNode;
}

interface Props<T extends string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the group, e.g. "Geräte filtern". */
  label: string;
}

/**
 * A segmented control: one row of mutually exclusive filters.
 *
 * This replaces a row of loose `.btn` elements. Three things that row got
 * wrong: the buttons carried no grouping semantics, so a screen reader
 * announced five unrelated controls instead of one choice; Tab stopped on
 * every single option; and nothing showed how many rows a filter would
 * actually leave behind, so "Offline" looked worth clicking even when it was
 * empty.
 *
 * Keyboard model is the ARIA tablist one: Tab enters the group at the active
 * option, arrow keys move between options, Home/End jump to the ends.
 */
export function FilterBar<T extends string>({ options, value, onChange, label }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const target = options[next];
    if (!target) return;
    onChange(target.id);
    // Focus follows selection, which is what makes arrow-key browsing of a
    // segmented control feel like one control rather than a list of buttons.
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        move(0, 0);
        break;
      case 'End':
        e.preventDefault();
        move(options.length - 1, 0);
        break;
      default:
        break;
    }
  };

  return (
    <div className="segmented" role="tablist" aria-label={label} ref={ref}>
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'segment active' : 'segment'}
            // Roving tabindex: the group is a single tab stop.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon}
            <span>{o.label}</span>
            {o.count !== undefined && (
              <span className={`segment-count tone-${o.tone ?? 'neutral'}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
