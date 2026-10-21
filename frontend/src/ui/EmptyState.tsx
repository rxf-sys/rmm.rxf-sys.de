import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}

/** An empty list that says why it is empty and what to do next. */
export function EmptyState({ icon, title, children, actions }: Props) {
  return (
    <div className="empty">
      {icon && <span className="empty-ico" aria-hidden>{icon}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
