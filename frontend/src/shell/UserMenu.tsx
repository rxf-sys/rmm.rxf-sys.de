import type { ReactNode } from 'react';
import { IconKeyboard, IconLaptop, IconLogout, IconMoon, IconSun } from '../icons';
import { roleLabel } from '../format';
import type { ThemePreference } from '../hooks/useTheme';
import type { Account } from '../types';
import { Popover, usePopoverClose } from '../ui';

interface Props {
  user: Account;
  theme: ThemePreference;
  onTheme: (t: ThemePreference) => void;
  onShortcuts: () => void;
  onLogout: () => void;
  /** 'rail' sits on the dark navigation rail; 'sheet' inside the mobile sheet. */
  variant?: 'rail' | 'sheet';
}

const THEMES: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'System', icon: <IconLaptop size={15} /> },
  { id: 'light', label: 'Hell', icon: <IconSun size={15} /> },
  { id: 'dark', label: 'Dunkel', icon: <IconMoon size={15} /> },
];

/** Theme choice as a radio group: three states, not a sun/moon toggle. */
export function ThemeChoice({ theme, onTheme }: Pick<Props, 'theme' | 'onTheme'>) {
  return (
    <div className="theme-choice" role="radiogroup" aria-label="Farbschema">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className="segment"
          onClick={() => onTheme(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function MenuBody({ user, theme, onTheme, onShortcuts, onLogout }: Omit<Props, 'variant'>) {
  const close = usePopoverClose();
  return (
    <div className="user-menu">
      <div className="user-menu-head">
        <span className="avatar" aria-hidden>
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <div className="user-name">{user.username}</div>
          <div className="user-role">{roleLabel(user.role)}</div>
        </div>
      </div>
      <div className="user-menu-section">
        <span className="user-menu-label">Farbschema</span>
        <ThemeChoice theme={theme} onTheme={onTheme} />
      </div>
      <button
        type="button"
        className="user-menu-item"
        onClick={() => {
          close();
          onShortcuts();
        }}
      >
        <IconKeyboard size={15} /> Tastaturkürzel <kbd>?</kbd>
      </button>
      <button type="button" className="user-menu-item" onClick={onLogout}>
        <IconLogout size={15} /> Abmelden
      </button>
    </div>
  );
}

/** The signed-in user at the foot of the rail; opens theme and sign-out. */
export function UserMenu(props: Props) {
  const { user } = props;
  return (
    <Popover
      label="Konto und Einstellungen"
      placement="top-start"
      className="popover-user"
      trigger={(t) => (
        <button {...t} type="button" className="rail-user">
          <span className="avatar" aria-hidden>
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          <span className="rail-user-text">
            <span className="user-name">{user.username}</span>
            <span className="user-role">{roleLabel(user.role)}</span>
          </span>
        </button>
      )}
    >
      <MenuBody {...props} />
    </Popover>
  );
}
