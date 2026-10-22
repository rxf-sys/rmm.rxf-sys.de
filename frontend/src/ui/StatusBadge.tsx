import type { ReactNode } from 'react';
import { IconInfo, IconPhone, IconStatusDanger, IconStatusOff, IconStatusOk, IconStatusWarn } from '../icons';

export type StatusKind = 'ok' | 'warn' | 'danger' | 'off' | 'noagent' | 'info' | 'neutral';

const DEFAULT_LABEL: Record<StatusKind, string> = {
  ok: 'OK',
  warn: 'Warnung',
  danger: 'Kritisch',
  off: 'Offline',
  noagent: 'Ohne Agent',
  info: 'Hinweis',
  neutral: '',
};

function icon(kind: StatusKind, size: number): ReactNode {
  switch (kind) {
    case 'ok':
      return <IconStatusOk size={size} />;
    case 'warn':
      return <IconStatusWarn size={size} />;
    case 'danger':
      return <IconStatusDanger size={size} />;
    case 'off':
      return <IconStatusOff size={size} />;
    case 'noagent':
      return <IconPhone size={size} />;
    default:
      return <IconInfo size={size} />;
  }
}

interface Props {
  kind: StatusKind;
  /** Visible word; defaults to the kind's name. */
  label?: ReactNode;
  /** Icon only (dense places like the sidebar). The label still reaches
   *  assistive technology. */
  iconOnly?: boolean;
  /** No pill background — for use inside text. */
  plain?: boolean;
  size?: number;
  title?: string;
}

/**
 * Status as icon and word. Colour supports the reading, it never carries it:
 * the five shapes differ (circle, triangle, octagon, dashed circle, phone).
 */
export function StatusBadge({ kind, label, iconOnly, plain, size = 14, title }: Props) {
  const text = label ?? DEFAULT_LABEL[kind];
  const cls = ['status', kind, plain ? 'plain' : '', iconOnly ? 'icon-only' : ''].filter(Boolean).join(' ');
  if (iconOnly) {
    return (
      <span className={cls} role="img" aria-label={typeof text === 'string' ? text : undefined} title={title ?? (typeof text === 'string' ? text : undefined)}>
        {icon(kind, size)}
      </span>
    );
  }
  return (
    <span className={cls} title={title}>
      {icon(kind, size)}
      {text}
    </span>
  );
}
