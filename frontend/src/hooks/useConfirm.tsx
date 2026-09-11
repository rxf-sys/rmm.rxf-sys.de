import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface AskOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Require the user to type this text before the confirm button unlocks. */
  requireText?: string;
}

/**
 * Promise-based confirmation, so call sites keep reading like the
 * `if (!confirm(...)) return;` they replace:
 *
 * ```ts
 * if (!(await ask({ title: '…', body: '…', confirmLabel: '…' }))) return;
 * ```
 *
 * Render `dialog` somewhere in the component. Only one request is live at a
 * time; a second `ask` while one is open replaces it, which cannot happen from
 * the UI because the open dialog traps focus.
 */
export function useConfirm() {
  const [req, setReq] = useState<(AskOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const ask = useCallback(
    (opts: AskOptions) => new Promise<boolean>((resolve) => setReq({ ...opts, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };

  const dialog = req ? (
    <ConfirmDialog
      title={req.title}
      body={req.body}
      confirmLabel={req.confirmLabel}
      danger={req.danger}
      requireText={req.requireText}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { ask, dialog };
}
