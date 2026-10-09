import { NavLink } from 'react-router-dom';
import { IconLogout } from '../icons';
import type { ThemePreference } from '../hooks/useTheme';
import type { Account } from '../types';
import { Modal } from '../components/Modal';
import { visibleGroups } from './nav';
import { ThemeChoice } from './UserMenu';

interface Props {
  user: Account;
  theme: ThemePreference;
  onTheme: (t: ThemePreference) => void;
  onLogout: () => void;
  onClose: () => void;
}

/** "Mehr" on phones: every page, the theme and sign-out, as a bottom sheet. */
export function MoreSheet({ user, theme, onTheme, onLogout, onClose }: Props) {
  return (
    <Modal title="Navigation" onClose={onClose}>
      <nav aria-label="Alle Bereiche" className="more-nav">
        {visibleGroups(user.role).map((g) => (
          <div key={g.label} className="more-group">
            <span className="more-group-label">{g.label}</span>
            <div className="more-grid">
              {g.items.map((it) => (
                <NavLink key={it.id} to={it.path} end={it.path === '/'} className="more-link" onClick={onClose}>
                  {it.icon}
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="more-group">
        <span className="more-group-label">Farbschema</span>
        <ThemeChoice theme={theme} onTheme={onTheme} />
      </div>
      <button type="button" className="btn" onClick={onLogout}>
        <IconLogout size={15} /> Abmelden ({user.username})
      </button>
    </Modal>
  );
}
