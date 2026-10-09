import { Link } from 'react-router-dom';
import { useNow } from '../../hooks/useNow';
import { isAgent, ownershipLabel } from '../../deviceClass';
import { deviceStatusKind, deviceStatusLabel } from '../../deviceStatus';
import { formatAgo, formatDateTime, osLabel } from '../../format';
import {
  IconBookmark,
  IconChevronLeft,
  IconExternal,
  IconMore,
  IconPower,
  IconRestart,
  IconTerminal,
  IconUpgrade,
  IconWrench,
  OsIcon,
} from '../../icons';
import type { Device } from '../../types';
import { Menu, StatusBadge, type MenuEntry } from '../../ui';

interface Props {
  device: Device;
  isOperator: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onSession: () => void;
  onTerminal: () => void;
  onWake: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onMaintenance: (minutes: number) => void;
  onUpdateAgent: () => void;
  onRemove: () => void;
}

const until = (ts: number) => new Date(ts * 1000).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Who the device is and what can be done with it. The one action that
 * matters most — open a remote session, or wake a sleeping machine — is the
 * primary button; the rest sits next to it on wide screens and in the menu
 * on narrow ones.
 */
export function DeviceHeader(p: Props) {
  const d = p.device;
  const agent = isAgent(d);
  const now = useNow();
  const inMaintenance = d.maintenance_until !== null && d.maintenance_until > now;
  const seen = agent ? d.last_seen_at : d.checked_at;

  const menu: MenuEntry[] = [
    { label: p.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: <IconBookmark size={14} />, onSelect: p.onToggleFavorite },
  ];
  if (p.isOperator) {
    if (agent) {
      menu.push(
        { label: 'Terminal öffnen', icon: <IconTerminal size={14} />, onSelect: p.onTerminal },
        { label: 'Neu starten …', icon: <IconRestart size={14} />, disabled: !d.connected, onSelect: p.onRestart },
      );
      if (!d.online) menu.push({ label: 'Aufwecken (Wake-on-LAN)', icon: <IconPower size={14} />, onSelect: p.onWake });
      if (d.agent_update_available)
        menu.push({ label: `Agent auf ${d.agent_update_available} aktualisieren …`, icon: <IconUpgrade size={14} />, disabled: !d.connected, onSelect: p.onUpdateAgent });
      menu.push(
        { heading: 'Wartung — Alarme aus' },
        { label: '1 Stunde', icon: <IconWrench size={14} />, onSelect: () => p.onMaintenance(60) },
        { label: '4 Stunden', icon: <IconWrench size={14} />, onSelect: () => p.onMaintenance(240) },
        { label: '24 Stunden', icon: <IconWrench size={14} />, onSelect: () => p.onMaintenance(1440) },
      );
      if (inMaintenance) menu.push({ label: 'Wartung beenden', onSelect: () => p.onMaintenance(0) });
    }
    menu.push('separator', { label: 'Bearbeiten …', onSelect: p.onEdit }, { label: 'Entfernen …', danger: true, onSelect: p.onRemove });
  }

  return (
    <header className="dv-head">
      <Link to="/devices" className="dv-back">
        <IconChevronLeft size={14} /> Geräte
      </Link>
      <div className="dv-head-main">
        <div className="dv-title-row">
          <h1 className="dv-title">{d.hostname}</h1>
          <StatusBadge kind={deviceStatusKind(d)} label={deviceStatusLabel(d)} />
          {inMaintenance && (
            <span className="chip" title={formatDateTime(d.maintenance_until!)}>
              <IconWrench size={12} /> Wartung bis {until(d.maintenance_until!)}
            </span>
          )}
        </div>
        <p className="dv-sub">
          <span className="dv-sub-os">
            <OsIcon os={d.os} size={13} /> {d.os_version || osLabel(d.os)}
          </span>
          {!agent && ownershipLabel(d) && <span>{ownershipLabel(d)}</span>}
          {d.owner_label && <span>{d.owner_label}</span>}
          <span title={seen ? formatDateTime(seen) : undefined}>
            {agent ? (d.online ? `gemeldet ${formatAgo(seen)}` : `zuletzt gesehen ${formatAgo(seen)}`) : seen ? `geprüft ${formatAgo(seen)}` : 'nie geprüft'}
          </span>
          {d.tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </p>
      </div>
      <div className="dv-actions">
        {agent && p.isOperator && (
          <>
            <button type="button" className="btn dv-wide-only" onClick={p.onTerminal}>
              <IconTerminal size={14} /> Terminal
            </button>
            <button type="button" className="btn dv-wide-only" onClick={p.onRestart} disabled={!d.connected} title={d.connected ? undefined : 'Gerät ist nicht verbunden'}>
              <IconRestart size={14} /> Neu starten
            </button>
          </>
        )}
        {!agent && p.isOperator && (
          <button type="button" className="btn" onClick={p.onEdit}>
            Bearbeiten
          </button>
        )}
        {agent && p.isOperator && !d.online ? (
          <button type="button" className="btn btn-primary" onClick={p.onWake}>
            <IconPower size={14} /> Aufwecken
          </button>
        ) : agent && d.rustdesk_id ? (
          <button type="button" className="btn btn-primary" onClick={p.onSession}>
            <IconExternal size={14} /> Fernsteuerung
          </button>
        ) : null}
        <Menu
          label={`Aktionen für ${d.hostname}`}
          items={menu}
          trigger={(t) => (
            <button type="button" className="btn btn-icon" aria-label="Weitere Aktionen" {...t}>
              <IconMore size={16} />
            </button>
          )}
        />
      </div>
    </header>
  );
}
