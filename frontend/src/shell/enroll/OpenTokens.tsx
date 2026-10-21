import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { api } from '../../api/client';
import { formatAgo, formatDateTime } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useNow } from '../../hooks/useNow';
import type { EnrollToken } from '../../types';
import { ErrorNote, SkeletonRows } from '../../ui';
import { notify } from '../../ui/toast';
import { ENROLL_TOKENS_KEY, enrollErrorText, formatRemaining } from './enrollText';

const tokenName = (t: EnrollToken) => (t.label ? `„${t.label}“` : 'ohne Bezeichnung');

/**
 * Tokens that no machine has used yet. Each one is a way into the fleet
 * until it expires, so the list sits next to the form that makes them, and
 * an unneeded one can be revoked right here.
 */
export function OpenTokens({
  justCreated,
  onRevoked,
}: {
  justCreated: number | null;
  /** After a token is revoked; the token form drops a command that used it. */
  onRevoked: (id: number) => void;
}) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  const { ask, dialog } = useConfirm();
  const [revoking, setRevoking] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const tokens = useQuery({
    queryKey: ENROLL_TOKENS_KEY,
    queryFn: ({ signal }) => api.enrollTokens(signal).then((r) => r.tokens),
  });
  const list = tokens.data ?? [];

  const revoke = async (t: EnrollToken) => {
    const ok = await ask({
      title: 'Token widerrufen',
      body: (
        <p>
          Das Token {tokenName(t)} wird sofort ungültig. Ein Rechner, auf dem der Installationsbefehl noch nicht gelaufen
          ist, kann sich damit nicht mehr anmelden. Bereits angemeldete Geräte sind nicht betroffen.
        </p>
      ),
      confirmLabel: 'Widerrufen',
      danger: true,
    });
    if (!ok) return;
    setRevoking(t.id);
    try {
      await api.deleteEnrollToken(t.id);
      onRevoked(t.id);
      notify.success('Token widerrufen', t.label || undefined);
    } catch (e) {
      notify.error('Widerrufen fehlgeschlagen', new Error(enrollErrorText(e)));
    } finally {
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: ENROLL_TOKENS_KEY });
      // The row with the focused button is gone; keep focus inside the dialog.
      headingRef.current?.focus();
    }
  };

  return (
    <section className="en-tokens" aria-labelledby={headingId}>
      <div className="en-tokens-head">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="en-h3">
          Offene Tokens
        </h3>
        {list.length > 0 && <span className="chip num">{list.length}</span>}
      </div>
      {tokens.isPending ? (
        <SkeletonRows rows={2} h={44} />
      ) : tokens.error ? (
        <ErrorNote error={enrollErrorText(tokens.error)} onRetry={() => void tokens.refetch()} />
      ) : list.length === 0 ? (
        <p className="en-none">Keine offenen Tokens. Ein Token steht hier, bis ein Rechner es benutzt hat oder es abläuft.</p>
      ) : (
        <ul className="en-token-list">
          {list.map((t) => (
            <li key={t.id} className="en-token">
              <div className="en-token-text">
                <span className="en-token-name">
                  {t.label ? <span className="en-token-label">{t.label}</span> : <span className="en-muted">Ohne Bezeichnung</span>}
                  {t.id === justCreated && <span className="chip">eben erzeugt</span>}
                </span>
                <span className="en-token-sub">
                  erzeugt <time title={formatDateTime(t.created_at)}>{formatAgo(t.created_at, now)}</time>
                  {' · '}
                  <time title={formatDateTime(t.expires_at)}>{formatRemaining(t.expires_at, now)}</time>
                </span>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void revoke(t)}
                disabled={revoking === t.id}
                aria-label={`Token ${tokenName(t)} widerrufen`}
              >
                {revoking === t.id ? 'Widerruft …' : 'Widerrufen'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
