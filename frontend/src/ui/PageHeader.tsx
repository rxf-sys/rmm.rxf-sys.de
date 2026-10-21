import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  /** Number shown quietly after the title (e.g. device count). */
  count?: number;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Content before the title, e.g. a back link. */
  leading?: ReactNode;
}

const fmt = new Intl.NumberFormat('de-DE');

/** The one h1 of a page, with its primary actions on the right. */
export function PageHeader({ title, count, subtitle, actions, leading }: Props) {
  return (
    <header className="page-header">
      {leading}
      <div className="page-header-text">
        <h1>
          {title}
          {count !== undefined && <span className="page-count">{fmt.format(count)}</span>}
        </h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
