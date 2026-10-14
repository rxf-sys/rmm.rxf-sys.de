import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { PopoverCloseContext } from './popoverContext';
import { useAnchoredPosition, type Placement } from './useAnchoredPosition';

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
  'aria-controls': string | undefined;
  onClick: () => void;
}

interface Props {
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  /** Accessible name of the panel. */
  label: string;
  placement?: Placement;
  className?: string;
}

/**
 * A non-modal floating panel anchored to a button: opens on click, closes on
 * Escape (focus returns to the trigger), on a click outside, or when its
 * content calls the function from `usePopoverClose()`.
 */
export function Popover({ trigger, children, label, placement = 'bottom-end', className }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPosition(open, triggerRef, panelRef, placement);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Focus goes in once the panel is placed: until then it has visibility:
  // hidden, and a browser ignores focus() on such an element.
  const visible = style.visibility !== 'hidden';
  useEffect(() => {
    if (open && visible) panelRef.current?.focus();
  }, [open, visible]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        leaveByTab(e);
      }
    };
    // The panel sits at the end of <body> (portal), so the browser's Tab out
    // of it would go on from there, back to the top of the page. Leaving past
    // the last control puts focus on the button first, so Tab moves on to
    // what follows it; Shift+Tab from the start stops on the button the
    // panel logically follows.
    const leaveByTab = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      const tabbables = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE));
      const atStart = active === panel || active === tabbables[0];
      const atEnd = tabbables.length === 0 || active === tabbables[tabbables.length - 1];
      if (e.shiftKey && atStart) {
        e.preventDefault();
        close(true);
      } else if (!e.shiftKey && atEnd) {
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const closeFromContent = useCallback(() => close(true), [close]);


  return (
    <>
      {trigger({
        ref: triggerRef,
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': open ? id : undefined,
        onClick: () => setOpen((o) => !o),
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            className={['popover', className].filter(Boolean).join(' ')}
            style={style}
          >
            <PopoverCloseContext.Provider value={closeFromContent}>{children}</PopoverCloseContext.Provider>
          </div>,
          document.body,
        )}
    </>
  );
}
