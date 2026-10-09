import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition, type Placement } from './useAnchoredPosition';

export type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { heading: string }
  | 'separator';

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}

interface Props {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuEntry[];
  label: string;
  placement?: Placement;
}

const isItem = (e: MenuEntry): e is Extract<MenuEntry, { onSelect: () => void }> =>
  typeof e === 'object' && 'onSelect' in e;

/**
 * Menu button with the WAI-ARIA menu pattern: arrow keys, Home/End, Enter and
 * Space to choose, Escape to close with focus back on the button, Tab to
 * leave. Opens without animation from the keyboard; a click gets a short
 * scale-in from the trigger's corner.
 */
export function Menu({ trigger, items, label, placement = 'bottom-end' }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [instant, setInstant] = useState(false);
  const style = useAnchoredPosition(open, triggerRef, menuRef, placement);

  const itemEls = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    [],
  );
  const focusAt = useCallback(
    (i: number) => {
      const els = itemEls();
      if (!els.length) return;
      els[(i + els.length) % els.length]?.focus();
    },
    [itemEls],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    focusAt(0);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close, focusAt]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const els = itemEls();
    const cur = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(cur + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(cur - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(els.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        onClick: () => {
          setInstant(false);
          setOpen((o) => !o);
        },
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setInstant(true);
            setOpen(true);
          }
        },
      })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            className={instant ? 'menu instant' : 'menu'}
            style={style}
            onKeyDown={onMenuKey}
          >
            {items.map((entry, i) => {
              if (entry === 'separator') return <div key={i} role="separator" className="menu-sep" />;
              if (!isItem(entry))
                return (
                  <div key={i} className="menu-heading" role="presentation">
                    {entry.heading}
                  </div>
                );
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={entry.disabled}
                  className={entry.danger ? 'menu-item danger' : 'menu-item'}
                  onClick={() => {
                    close(true);
                    entry.onSelect();
                  }}
                >
                  {entry.icon && <span className="menu-ico">{entry.icon}</span>}
                  <span className="menu-label">{entry.label}</span>
                  {entry.hint && <span className="menu-hint">{entry.hint}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
