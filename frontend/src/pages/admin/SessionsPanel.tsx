import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, api } from '../../api/client';
import { formatAgo, formatDateTime } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import type { SessionInfo } from '../../types';
import { ErrorNote, Panel, SkeletonRows } from '../../ui';
import { notify } from '../../ui/toast';
import { adminKeys, formatDate } from './accounts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Ago({ ts, now }: { ts: number; now: number }) {
  return (
    <time dateTime={new Date(ts * 1000).toISOString()} title={formatDateTime(ts)}>
      {formatAgo(ts, now)}
    </time>
  );
}

/** Where the signed-in user is logged in, with a way to end the others. */
export function SessionsPanel({ now }: { now: number }) {
  const qc = useQueryClient();
  const { ask, dialog } = useConfirm();
  const q = useQuery({ queryKey: adminKeys.sessions, queryFn: ({ signal }) => api.sessions(signal).then((r) => r.sessions) });
  const others = q.data?.filter((s) => !s.current) ?? [];
  const reload = () => qc.invalidateQueries({ queryKey: adminKeys.sessions });

  // Sessions being ended. The ref guards the handler — a double click's
  // second event can arrive before the re-render — the state draws the row.
  const inFlight = useRef(new Set<string>());
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(() => new Set());
  const track = (prefix: string, on: boolean) => {
    if (on) inFlight.current.add(prefix);
    else inFlight.current.delete(prefix);
    setRevoking(new Set(inFlight.current));
  };

  const revoke = async (s: SessionInfo) => {
    if (inFlight.current.has(s.token_prefix)) return;
    track(s.token_prefix, true);
    try {
      await api.revokeSession(s.token_prefix);
      notify.success('Sitzung abgemeldet', `${s.token_prefix}…`);
    } catch (e) {
      // Gone already — expired, or ended in another tab. What the user
      // wanted is true, so it is not reported as a failure.
      if (e instanceof ApiError && e.status === 404) notify.info('Sitzung war schon beendet', `${s.token_prefix}…`);
      else notify.error('Sitzung nicht abgemeldet', e);
    } finally {
      await reload();
      track(s.token_prefix, false);
    }
  };

  const revokeOthers = async () => {
    const ok = await ask({
      title: 'Alle anderen Sitzungen abmelden?',
      body: `${plural(others.length, 'andere Sitzung', 'andere Sitzungen')} deines Kontos ${others.length === 1 ? 'endet' : 'enden'} sofort — in anderen Browsern oder auf anderen Geräten. Diese Sitzung bleibt angemeldet.`,
      confirmLabel: 'Abmelden',
    });
    if (!ok) return;
    try {
      const r = await api.revokeOtherSessions();
      await reload();
      notify.success(`${plural(r.revoked, 'Sitzung', 'Sitzungen')} abgemeldet`);
    } catch (e) {
      notify.error('Sitzungen nicht abgemeldet', e);
    }
  };

  return (
    <Panel
      title="Deine Sitzungen"
      meta={q.data ? plural(q.data.length, 'Sitzung', 'Sitzungen') : undefined}
      padded={false}
      actions={
        others.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => void revokeOthers()}>
            Alle anderen abmelden
          </button>
        )
      }
    >
      {dialog}
      {q.error && (
        <div className="ad-pad">
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        </div>
      )}
      {/* A failed refresh keeps the sessions already shown, below the error. */}
      {q.data ? (
        <ul className="ad-list">
          {q.data.map((s) => (
            <li key={s.token_prefix} className="ad-row">
              <div className="ad-row-text">
                <span className="ad-row-title">
                  <code className="mono">{s.token_prefix}…</code>
                  {s.current && <span className="chip">diese Sitzung</span>}
                </span>
                <span className="ad-row-sub">
                  angemeldet <Ago ts={s.created_at} now={now} /> · zuletzt aktiv <Ago ts={s.last_seen_at} now={now} /> · gültig bis{' '}
                  <span title={formatDateTime(s.expires_at)}>{formatDate(s.expires_at)}</span>
                </span>
              </div>
              {!s.current && (
                // aria-disabled rather than disabled: a disabled button drops
                // the focus of whoever just pressed it.
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-disabled={revoking.has(s.token_prefix) || undefined}
                  onClick={() => void revoke(s)}
                >
                  {revoking.has(s.token_prefix) ? 'Meldet ab …' : 'Abmelden'}
                  <span className="sr-only"> (Sitzung {s.token_prefix}…)</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !q.error && (
          <div className="ad-pad">
            <SkeletonRows rows={2} h={40} />
          </div>
        )
      )}
    </Panel>
  );
}
