import type { Ref } from 'react';
import { IconChevronDown, IconClock, IconRestart, IconShield, IconX } from '../../icons';
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
  /** Install on each device's next time online. */
  onQueue: () => void;
  onClear: () => void;
  /** Where the page puts the focus when the control that had it goes away. */
  ref?: Ref<HTMLElement>;
}

/**
 * What can be done with the selection. The page owns the work; this bar only
 * offers it — two buttons on a wide screen, one menu on a phone.
 *
 * While a run is busy the buttons are aria-disabled rather than disabled: a
 * disabled button drops the focus it has, and a keyboard user would start
 * over at the top of the page. The same goes for the install button without
 * security updates, which a poll can switch while it has the focus; its
 * reason stays reachable as the button's description.
 */
export function PatchBulkBar({ count, hidden, withSecurity, busy, onScan, onInstall, onQueue, onClear, ref }: Props) {
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
    { label: 'Beim nächsten Online installieren …', icon: <IconClock size={14} />, onSelect: onQueue },
  ];

  return (
    <section className="bulkbar" aria-label="Auswahl" tabIndex={-1} ref={ref}>
      <p className="bulkbar-count" aria-live="polite">
        <b className="num">{fmt.format(count)}</b> ausgewählt
        {hidden > 0 && <span className="muted"> · {fmt.format(hidden)} davon ausgeblendet</span>}
      </p>
      <div className="bulkbar-actions">
        <button
          type="button"
          className="btn btn-sm"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onScan();
          }}
        >
          <IconRestart size={14} /> Jetzt prüfen
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-disabled={busy || noSecurity || undefined}
          title={installHint}
          onClick={() => {
            if (!busy && !noSecurity) onInstall();
          }}
        >
          <IconShield size={14} /> Sicherheitsupdates installieren
          {!noSecurity && <span className="bulkbar-n num">{fmt.format(withSecurity)}</span>}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onQueue();
          }}
        >
          <IconClock size={14} /> Beim nächsten Online installieren
        </button>
      </div>
      <div className="bulkbar-menu">
        <Menu
          label="Aktionen für die Auswahl"
          placement="top-end"
          items={actions}
          trigger={(p) => (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              {...p}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) p.onClick();
              }}
              onKeyDown={(e) => {
                if (!busy) p.onKeyDown(e);
              }}
            >
              Aktionen <IconChevronDown size={14} />
            </button>
          )}
        />
      </div>
      <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClear} aria-label="Auswahl aufheben" title="Auswahl aufheben">
        <IconX size={16} />
      </button>
    </section>
  );
}
