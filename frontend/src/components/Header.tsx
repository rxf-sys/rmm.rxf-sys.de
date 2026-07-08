interface Props {
  crumbPre: string;
  crumbCur: string;
  openAlerts: number;
  isAdmin: boolean;
  onOpenPalette: () => void;
  onOpenAlerts: () => void;
  onOpenEnroll: () => void;
}

export function Header({
  crumbPre,
  crumbCur,
  openAlerts,
  isAdmin,
  onOpenPalette,
  onOpenAlerts,
  onOpenEnroll,
}: Props) {
  return (
    <div className="header">
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
        {isAdmin && (
          <button className="btn btn-primary" onClick={onOpenEnroll}>
            + Gerät
          </button>
        )}
      </div>
    </div>
  );
}
