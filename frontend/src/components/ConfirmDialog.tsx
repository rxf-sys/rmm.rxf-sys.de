import { Modal } from './Modal';

interface Props {
  title: string;
  /** What will happen, in the user's terms. Not "Sind Sie sicher?". */
  body: React.ReactNode;
  confirmLabel: string;
  /** Red button for anything that destroys data or runs code on a device. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for actions that are hard to take back.
 *
 * Replaces `window.confirm`, which blocks the whole tab, cannot be styled or
 * translated consistently, is suppressible by the browser, and gives no room
 * to say what the consequence actually is. This one is a real dialog: focus
 * trap, Escape, and a body that names the effect rather than asking whether
 * the user is sure.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--tx2)' }}>{body}</div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Läuft…' : confirmLabel}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </Modal>
  );
}
