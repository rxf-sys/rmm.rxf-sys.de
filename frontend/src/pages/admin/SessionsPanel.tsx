import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
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

  const revoke = async (s: SessionInfo) => {
    try {
      await api.revokeSession(s.token_prefix);
      await reload();
      notify.success('Sitzung abgemeldet', `${s.token_prefix}…`);
    } catch (e) {
      notify.error('Sitzung nicht abgemeldet', e);
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
                <button type="button" className="btn btn-sm" onClick={() => void revoke(s)}>
                  Abmelden<span className="sr-only"> (Sitzung {s.token_prefix}…)</span>
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
