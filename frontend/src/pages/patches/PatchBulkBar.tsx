import { IconChevronDown, IconRestart, IconShield, IconX } from '../../icons';
import { Menu, type MenuEntry } from '../../ui';

const fmt = new Intl.NumberFormat('de-DE');

interface Props {
  count: number;
  /** Selected devices the current filter hides. */
  hidden: number;
  /** Selected devices with at least one open security update. */
  withSecurity: number;
  busy: boolean;
  onScan: () => void;
  onInstall: () => void;
  onClear: () => void;
}

/**
 * What can be done with the selection. The page owns the work; this bar only
 * offers it — two buttons on a wide screen, one menu on a phone.
 */
export function PatchBulkBar({ count, hidden, withSecurity, busy, onScan, onInstall, onClear }: Props) {
  const noSecurity = withSecurity === 0;
  const installHint = noSecurity ? 'Kein ausgewähltes Gerät hat offene Sicherheitsupdates' : undefined;
  const actions: MenuEntry[] = [
    { label: 'Jetzt prüfen', icon: <IconRestart size={14} />, onSelect: onScan },
    {
      label: 'Sicherheitsupdates installieren …',
      icon: <IconShield size={14} />,
      hint: noSecurity ? undefined : fmt.format(withSecurity),
      disabled: noSecurity,
      onSelect: onInstall,
    },
  ];

  return (
    <div className="bulkbar" role="region" aria-label="Auswahl">
      <p className="bulkbar-count" aria-live="polite">
        <b className="num">{fmt.format(count)}</b> ausgewählt
        {hidden > 0 && <span className="muted"> · {fmt.format(hidden)} davon ausgeblendet</span>}
      </p>
      <div className="bulkbar-actions">
        <button type="button" className="btn btn-sm" onClick={onScan} disabled={busy}>
          <IconRestart size={14} /> Jetzt prüfen
        </button>
        <button type="button" className="btn btn-sm" onClick={onInstall} disabled={busy || noSecurity} title={installHint}>
          <IconShield size={14} /> Sicherheitsupdates installieren
          {!noSecurity && <span className="bulkbar-n num">{fmt.format(withSecurity)}</span>}
        </button>
      </div>
      <div className="bulkbar-menu">
        <Menu
          label="Aktionen für die Auswahl"
          placement="top-end"
          items={actions}
          trigger={(p) => (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} {...p}>
              Aktionen <IconChevronDown size={14} />
            </button>
          )}
        />
      </div>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClear} aria-label="Auswahl aufheben" title="Auswahl aufheben">
        <IconX size={16} />
      </button>
    </div>
  );
}
