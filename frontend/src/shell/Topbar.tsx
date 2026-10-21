import { Link } from 'react-router-dom';
import { IconPlus, IconSearch } from '../icons';
import type { Alert, Device } from '../types';
import { NotificationCenter } from './NotificationCenter';

export interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  crumbs: Crumb[];
  alerts: Alert[];
  devices: Device[];
  canEnroll: boolean;
  onOpenPalette: () => void;
  onOpenEnroll: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Top bar: where am I, search/commands, notifications, add a device. */
export function Topbar({ crumbs, alerts, devices, canEnroll, onOpenPalette, onOpenEnroll }: Props) {
  const current = crumbs.at(-1)?.label ?? '';
  return (
    <header className="topbar">
      <Link to="/" className="topbar-mark" aria-label="Vulpexa, zur Übersicht">
        <img src="/favicon.svg" alt="" width={26} height={26} data-boot-target />
      </Link>
      <nav className="crumbs" aria-label="Pfad">
        <ol>
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`}>
              {i < crumbs.length - 1 && c.to ? (
                <Link to={c.to}>{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <span className="topbar-title" aria-hidden>
        {current}
      </span>

      <div className="topbar-actions">
        <button type="button" className="search-trigger" onClick={onOpenPalette} aria-keyshortcuts="Meta+K Control+K">
          <IconSearch size={15} />
          <span className="search-trigger-text">Suchen oder Befehl …</span>
          <kbd>{isMac ? '⌘K' : 'Strg K'}</kbd>
        </button>
        <NotificationCenter alerts={alerts} devices={devices} />
        {canEnroll && (
          <button type="button" className="btn btn-primary topbar-add" onClick={onOpenEnroll}>
            <IconPlus size={15} />
            <span>Gerät hinzufügen</span>
          </button>
        )}
      </div>
    </header>
  );
}
