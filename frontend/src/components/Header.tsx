interface Props {
  crumbPre: string;
  crumbCur: string;
  openAlerts: number;
  canEnroll: boolean;
  onOpenPalette: () => void;
  onOpenAlerts: () => void;
  onOpenEnroll: () => void;
  onToggleNav: () => void;
}

export function Header({
  crumbPre,
  crumbCur,
  openAlerts,
  canEnroll,
  onOpenPalette,
  onOpenAlerts,
  onOpenEnroll,
  onToggleNav,
}: Props) {
  return (
    <div className="header">
      <button className="btn-icon burger" title="Menü" aria-label="Menü" onClick={onToggleNav}>
        ☰
      </button>
      <span className="crumb">
        {crumbPre}
        <span className="cur">{crumbCur}</span>
      </span>
      <div className="header-right">
        <button className="search-pill" onClick={onOpenPalette}>
          ⌕ Suchen oder Befehl…
          <span className="kbd">⌘K</span>
        </button>
        <button className="btn-icon" title="Alarme" onClick={onOpenAlerts}>
          ◎{openAlerts > 0 && <span className="dot-notify" />}
        </button>
        {canEnroll && (
          <button className="btn btn-primary" onClick={onOpenEnroll}>
            + Gerät
          </button>
        )}
      </div>
    </div>
  );
}
