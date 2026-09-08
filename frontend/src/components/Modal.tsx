import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

/** Elements that can hold focus, in DOM order. Used for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  /** Accessible name of the dialog. Rendered as the heading unless `hideTitle`. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wrapper class for layout variants (`modal-wrap`, `palette-wrap`). */
  wrapClassName?: string;
  /** Class of the panel itself (`modal`, `palette`). */
  panelClassName?: string;
  /** Palette-style dialogs label themselves through their input instead. */
  hideTitle?: boolean;
  /** Rendered next to the heading, e.g. a close button. */
  headerExtra?: ReactNode;
};

/**
 * A dialog that behaves like one.
 *
 * The hand-rolled `div.overlay > div.modal` pattern this replaces had three
 * problems: a click handler on a non-interactive div (unreachable by keyboard),
 * no `role="dialog"`, and focus that stayed behind in the page — so Tab walked
 * through the obscured content while the dialog was open, and closing it left
 * focus nowhere.
 *
 * This component keeps the same markup classes, and adds: Escape to close,
 * a focus trap, initial focus on the first focusable element, focus restored to
 * whatever was focused before, and the ARIA a screen reader needs.
 */
export function Modal({
  title,
  onClose,
  children,
  wrapClassName = 'modal-wrap',
  panelClassName = 'modal',
  hideTitle = false,
  headerExtra,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Remember where focus came from, move it into the dialog, put it back on
  // unmount. The ref is read in the cleanup, so it must be captured up front.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => restoreTo.current?.focus?.();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      // Wrap around instead of letting Tab escape into the page behind.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div className={`overlay ${wrapClassName}`}>
      {/* A real button, so "click the backdrop to close" is also reachable by
          keyboard and announced. It sits behind the panel via CSS. */}
      <button type="button" className="overlay-backdrop" aria-label="Dialog schließen" onClick={onClose} />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the
          handler implements the dialog's own Escape/Tab semantics, not a control. */}
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-label={hideTitle ? title : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {!hideTitle && (
          <div className="row">
            <span id={titleId} style={{ fontWeight: 800, fontSize: 16 }}>
              {title}
            </span>
            {headerExtra}
          </div>
        )}
        {hideTitle ? headerExtra : null}
        {children}
      </div>
    </div>
  );
}
