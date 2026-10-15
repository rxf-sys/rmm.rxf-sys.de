import { useId, type ReactNode } from 'react';

interface Props {
  title?: ReactNode;
  /** Quiet text next to the title (count, time range, source). */
  meta?: ReactNode;
  /** Right-aligned controls in the header. */
  actions?: ReactNode;
  children: ReactNode;
  /** Pad the body. Off for lists and tables that run edge to edge. */
  padded?: boolean;
  className?: string;
  /** Heading level of the title (h2 on pages, h3 inside tabs). */
  level?: 2 | 3;
}

/** A titled region of a page. Flat surface, one hairline, no shadow. */
export function Panel({ title, meta, actions, children, padded = true, className, level = 2 }: Props) {
  const id = useId();
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <section className={['panel', className].filter(Boolean).join(' ')} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className="panel-head">
          {title && (
            <H id={id} className="panel-title">
              {title}
            </H>
          )}
          {meta && <span className="panel-meta">{meta}</span>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'panel-body' : 'panel-body flush'}>{children}</div>
    </section>
  );
}
