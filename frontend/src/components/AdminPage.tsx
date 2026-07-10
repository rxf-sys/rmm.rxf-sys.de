import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { formatRelative } from '../format';
import type { Account } from '../types';
import { AdminExtras } from './AdminExtras';

interface Props {
  currentUser: Account;
}

interface Draft {
  username: string;
  password: string;
  role: 'admin' | 'techniker' | 'viewer';
  email: string;
}

const EMPTY: Draft = { username: '', password: '', role: 'viewer', email: '' };
const COLS = '14fr 12fr 8fr 8fr 10fr 16fr';

export function AdminPage({ currentUser }: Props) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .accounts()
      .then((r) => setAccounts(r.accounts))
      .catch((e) => setError(apiErrorMessage(e)));

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const create = () =>
    run(async () => {
      if (!draft) return;
      await api.createAccount({
        username: draft.username.trim(),
        password: draft.password,
        role: draft.role,
        email: draft.email.trim() || undefined,
      });
      setDraft(null);
    });

  const doReset = () =>
    run(async () => {
      if (resetFor === null) return;
      await api.updateAccount(resetFor, { password: resetPw });
      setResetFor(null);
      setResetPw('');
    });

  return (
    <div className="screen">
      <div className="page-head center">
        <h1 className="page-title">Administration</h1>
        <span className="muted">Benutzer, Sicherheit &amp; Benachrichtigungen</span>
        {!draft && (
          <button
            className="btn btn-primary grow"
            style={{ marginLeft: 'auto' }}
            onClick={() => setDraft({ ...EMPTY })}
          >
            + Neuer Benutzer
          </button>
        )}
      </div>

      {error && <p className="err">{error}</p>}

      {draft && (
        <div
          className="card card-pad"
          style={{ borderColor: 'var(--accLine)', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <span className="card-title">Neuer Benutzer</span>
          <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 140px' }}
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              placeholder="Benutzername"
              autoFocus
            />
            <input
              className="input"
              style={{ flex: '1 1 160px' }}
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              placeholder="Passwort (min. 8 Zeichen)"
            />
            <select
              className="input"
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as 'admin' | 'techniker' | 'viewer' })}
            >
              <option value="viewer">Betrachter</option>
              <option value="techniker">Techniker</option>
              <option value="admin">Administrator</option>
            </select>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="E-Mail (optional)"
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={() => void create()}
              disabled={!draft.username.trim() || draft.password.length < 8}
            >
              Anlegen
            </button>
            <button className="btn" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="tbl-scroll">
          <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 760 }}>
            <span>Benutzer</span>
            <span>E-Mail</span>
            <span>Rolle</span>
            <span>Status</span>
            <span>Letzter Login</span>
            <span style={{ textAlign: 'right' }}>Aktionen</span>
          </div>
          {accounts === null ? (
            <div style={{ padding: '14px 16px' }} className="muted">
              Lade…
            </div>
          ) : (
            accounts.map((a) => {
              const self = a.id === currentUser.id;
              return (
                <div
                  key={a.id}
                  className="tbl-row"
                  style={{ gridTemplateColumns: COLS, cursor: 'default', minWidth: 760 }}
                >
                  <span className="cell-name">
                    <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                      {a.username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="name">
                      {a.username}
                      {self && <span className="muted" style={{ fontWeight: 500 }}> (du)</span>}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{a.email || '—'}</span>
                  <span>
                    <select
                      className="input btn-sm"
                      style={{ padding: '4px 8px' }}
                      value={a.role}
                      disabled={self}
                      onChange={(e) => void run(() => api.updateAccount(a.id, { role: e.target.value }))}
                    >
                      <option value="viewer">Betrachter</option>
                      <option value="techniker">Techniker</option>
                      <option value="admin">Admin</option>
                    </select>
                  </span>
                  <span>
                    <span className={a.disabled ? 'badge badge-danger' : 'badge badge-ok'}>
                      {a.disabled ? 'deaktiviert' : 'aktiv'}
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {a.last_login_at ? formatRelative(a.last_login_at) : 'nie'}
                  </span>
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => { setResetFor(a.id); setResetPw(''); }}>
                      Passwort
                    </button>
                    {!self && (
                      <>
                        <button
                          className="btn btn-sm"
                          onClick={() => void run(() => api.updateAccount(a.id, { disabled: !a.disabled }))}
                        >
                          {a.disabled ? 'Aktivieren' : 'Deaktivieren'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (confirm(`Konto „${a.username}" wirklich löschen?`)) {
                              void run(() => api.deleteAccount(a.id));
                            }
                          }}
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <AdminExtras currentUser={currentUser} />

      {resetFor !== null && (
        <div className="overlay modal-wrap" onClick={() => setResetFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>
              Passwort zurücksetzen — {accounts?.find((a) => a.id === resetFor)?.username}
            </span>
            <input
              className="input"
              type="password"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              placeholder="Neues Passwort (min. 8 Zeichen)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && resetPw.length >= 8) void doReset();
              }}
            />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={() => void doReset()} disabled={resetPw.length < 8}>
                Setzen
              </button>
              <button className="btn" onClick={() => setResetFor(null)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
