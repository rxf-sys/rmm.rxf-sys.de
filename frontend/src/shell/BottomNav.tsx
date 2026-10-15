import { NavLink } from 'react-router-dom';
import { IconBell, IconGrid, IconMenu, IconMonitor } from '../icons';
import { PAGE_PATH } from '../routes';

interface Props {
  openAlerts: number;
  moreOpen: boolean;
  onMore: () => void;
}

/** Phone navigation in thumb reach: the three on-call destinations + more. */
export function BottomNav({ openAlerts, moreOpen, onMore }: Props) {
  return (
    <nav className="bottomnav" aria-label="Hauptnavigation">
      <NavLink to={PAGE_PATH.overview} end className="bottomnav-link">
        <IconGrid size={20} />
        <span>Übersicht</span>
      </NavLink>
      <NavLink to={PAGE_PATH.devices} className="bottomnav-link">
        <IconMonitor size={20} />
        <span>Geräte</span>
      </NavLink>
      <NavLink to={PAGE_PATH.alerts} className="bottomnav-link">
        <span className="bottomnav-ico">
          <IconBell size={20} />
          {openAlerts > 0 && <span className="count-notify">{openAlerts > 99 ? '99+' : openAlerts}</span>}
        </span>
        <span>Alarme</span>
        {openAlerts > 0 && <span className="sr-only">, {openAlerts} offen</span>}
      </NavLink>
      <button type="button" className="bottomnav-link" aria-expanded={moreOpen} onClick={onMore}>
        <IconMenu size={20} />
        <span>Mehr</span>
      </button>
    </nav>
  );
}
