import { useRef } from 'react';

export interface DeviceTab<T extends string> {
  id: T;
  label: string;
  /** Kleine Zahl hinter dem Namen — nur, wo sie eine Entscheidung trägt. */
  count?: number;
  tone?: 'neutral' | 'warn' | 'danger';
}

interface Props<T extends string> {
  tabs: DeviceTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}

/**
 * Die Reiter einer Geräteseite.
 *
 * Vorher eine Reihe loser `<button>`: ohne Gruppensemantik (ein Screenreader
 * las acht unverbundene Schaltflächen statt einer Auswahl), mit einem
 * Tabstopp je Reiter, und ohne jeden Hinweis darauf, hinter welchem Reiter
 * etwas liegt, das Aufmerksamkeit braucht. Tastaturmodell wie bei der
 * Filterleiste: Tab springt in die Gruppe, Pfeiltasten wechseln.
 */
export function DeviceTabs<T extends string>({ tabs, value, onChange, label }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
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
        move(tabs.length - 1, 0);
        break;
      default:
        break;
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref}>
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'tab active' : 'tab'}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`tab-count tone-${t.tone ?? 'neutral'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
