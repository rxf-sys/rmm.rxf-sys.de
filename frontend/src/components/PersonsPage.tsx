import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import { usePagination } from '../hooks/usePagination';
import { roleLabel } from '../format';
import type { Account, Alert, AuditEvent, Device, PatchSummary, Person } from '../types';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import { PersonDetail } from './PersonDetail';

interface Props {
  persons: Person[];
  devices: Device[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  isAdmin: boolean;
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
}

interface Draft {
  id: number | null;
  name: string;
  email: string;
  phone: string;
  notes: string;
}

const EMPTY: Draft = { id: null, name: '', email: '', phone: '', notes: '' };

export function PersonsPage({
  persons,
  devices,
  alerts,
  patchSummary,
  isAdmin,
  onOpenDevice,
  onRefresh,
}: Props) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<AuditEvent[] | null>(null);
  const [resetFor, setResetFor] = useState<Account | null>(null);
  const [resetPw, setResetPw] = useState('');
  // Zugangsdaten des automatisch angelegten Betrachter-Kontos — erscheinen
  // genau einmal nach dem Anlegen (das Passwort ist danach nicht mehr abrufbar).
  const [createdLogin, setCreatedLogin] = useState<{ username: string; password: string } | null>(
    null,
  );

  const nameRef = useRef<HTMLInputElement>(null);
  // One stable key per open form: "new", or the id being edited. Focus follows
  // the form when it is revealed — the point autoFocus got right, without
  // moving focus unexpectedly on page load.
  const draftKey = draft ? String(draft.id ?? 'new') : null;
  useEffect(() => {
    if (draftKey !== null) nameRef.current?.focus();
  }, [draftKey]);

  // Accounts and the audit log are admin-only. A techniker or viewer opening
  // this page gets the fleet half of the detail pane and nothing else, rather
  // than an error for something they never asked for.
  useEffect(() => {
    if (!isAdmin) return;
    const ctrl = new AbortController();
    api
      .accounts(ctrl.signal)
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts([]));
    api
      .audit({ limit: 200 }, ctrl.signal)
      .then((r) => setActivity(r.events))
      .catch(() => setActivity([]));
    return () => ctrl.abort();
  }, [isAdmin]);

  // Selection follows the data: a deleted person, or a first load, must not
  // leave the pane pointing at nothing.
  const selected = persons.find((p) => p.id === selectedId) ?? persons[0] ?? null;

  const accountFor = (personId: number) =>
    accounts.find((a) => a.person_id === personId) ?? null;

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        notes: draft.notes.trim(),
      };
      if (draft.id === null) {
        const r = await api.createPerson(body);
        if (r.account && r.initial_password) {
          setCreatedLogin({ username: r.account.username, password: r.initial_password });
        }
        setSelectedId(r.person.id);
      } else {
        await api.updatePerson(draft.id, body);
      }
      setDraft(null);
      onRefresh();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const remove = async (p: Person) => {
    const ok = await ask({
      title: 'Person löschen',
      body: (
        <>
          <strong>{p.name}</strong> wird entfernt. Zugewiesene Geräte bleiben erhalten und werden
          nur entkoppelt; das verknüpfte Betrachter-Konto wird mitgelöscht.
        </>
      ),
      confirmLabel: 'Person löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePerson(p.id);
      setSelectedId(null);
      onRefresh();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const resetPassword = async () => {
    if (!resetFor) return;
    setError(null);
    try {
      await api.updateAccount(resetFor.id, { password: resetPw });
      setResetFor(null);
      setResetPw('');
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const viewerCount = accounts.filter(
    (a) => a.role === 'viewer' && a.person_id !== null && a.person_id !== undefined,
  ).length;
  const assignedCount = devices.filter((d) => d.person_id !== null).length;

  const pager = usePagination(persons, 'persons');

  return (
    <div className="screen">
      {confirmDialog}
      {createdLogin && (
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>Betrachter-Konto angelegt</span>
          <span className="muted" style={{ lineHeight: 1.6 }}>
            Für die neue Person wurde automatisch ein Konto erstellt. Es sieht nur die Geräte,
            die dieser Person zugewiesen sind.
          </span>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <span>
              Benutzername:{' '}
              <span className="mono" style={{ fontWeight: 700 }}>{createdLogin.username}</span>
            </span>
            <span>
              Passwort: <span className="mono" style={{ fontWeight: 700 }}>{createdLogin.password}</span>
            </span>
            <button
              className="btn btn-sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${createdLogin.username} / ${createdLogin.password}`)
                  // Clipboard denied — the credentials are visible above.
                  .catch(() => {})
              }
            >
              Kopieren
            </button>
            <button className="btn btn-sm" onClick={() => setCreatedLogin(null)}>
              Schließen
            </button>
          </div>
          <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--warn)' }}>
            ⚠ Das Passwort wird nur einmal angezeigt — jetzt weitergeben oder notieren.
          </span>
        </div>
      )}

      <div className="page-head center">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 className="page-title">Personen</h1>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {persons.length} Personen · {viewerCount} Betrachter-Konten · {assignedCount} Geräte
            zugewiesen
          </span>
        </div>
        {isAdmin && !draft && (
          <button
            className="btn btn-primary grow"
            style={{ marginLeft: 'auto' }}
            onClick={() => setDraft({ ...EMPTY })}
          >
            + Neue Person
          </button>
        )}
      </div>

      {error && <p className="err">{error}</p>}

      {draft && (
        <div
          className="card card-pad"
          style={{ borderColor: 'var(--accLine)', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <span className="card-title">{draft.id === null ? 'Neue Person' : 'Person bearbeiten'}</span>
          <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 160px' }}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name, z. B. Mama"
              aria-label="Name der Person"
              ref={nameRef}
            />
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="E-Mail (optional)"
              aria-label="E-Mail"
            />
            <input
              className="input"
              style={{ flex: '1 1 130px' }}
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="Telefon (optional)"
              aria-label="Telefon"
            />
          </div>
          <input
            className="input"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notizen (optional)"
            aria-label="Notizen"
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void save()} disabled={!draft.name.trim()}>
              Speichern
            </button>
            <button className="btn" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {persons.length === 0 && !draft ? (
        <div className="empty">
          <h2>Noch keine Personen</h2>
          <p className="muted">
            Lege Personen an (Familie, Kunden) und weise ihnen Geräte zu — danach kannst du Geräte
            und Alarm-Regeln nach Person filtern.
          </p>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => setDraft({ ...EMPTY })}>
              + Neue Person anlegen
            </button>
          )}
        </div>
      ) : (
        <div className="persons-layout">
          <div className="card" style={{ overflow: 'hidden' }}>
            <ul className="person-list">
              {pager.items.map((p) => {
                const owned = devices.filter((d) => d.person_id === p.id);
                const account = accountFor(p.id);
                const active = selected?.id === p.id;
                return (
                  <li key={p.id}>
                    <button
                      className={active ? 'person-item active' : 'person-item'}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                      <span className="person-item-text">
                        <span className="person-item-name">
                          {p.name}
                          {owned.some((d) => !d.online) && (
                            <span
                              className="dot"
                              style={{ width: 6, height: 6, background: 'var(--dangerS)' }}
                              title="mindestens ein Gerät offline"
                            />
                          )}
                        </span>
                        <span className="muted" style={{ fontSize: 10.5 }}>
                          {owned.length} Gerät{owned.length === 1 ? '' : 'e'} ·{' '}
                          {owned.filter((d) => d.online).length} online
                        </span>
                      </span>
                      {account && (
                        <span className="badge badge-off person-item-role">
                          {roleLabel(account.role)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination {...pager} label="Personen" />
          </div>

          {selected && (
            <PersonDetail
              key={selected.id}
              person={selected}
              devices={devices.filter((d) => d.person_id === selected.id)}
              allDevices={devices}
              account={accountFor(selected.id)}
              activity={isAdmin ? activity : null}
              alerts={alerts}
              patchSummary={patchSummary}
              isAdmin={isAdmin}
              onEdit={() => setDraft({ ...selected })}
              onDelete={() => void remove(selected)}
              onOpenDevice={onOpenDevice}
              onRefresh={onRefresh}
              onResetPassword={(a) => {
                setResetPw('');
                setResetFor(a);
              }}
            />
          )}
        </div>
      )}

      {resetFor !== null && (
        <Modal title={`Passwort zurücksetzen — ${resetFor.username}`} onClose={() => setResetFor(null)}>
          <label className="field" htmlFor="person-reset-pw">
            <span className="field-label">Neues Passwort (min. 8 Zeichen)</span>
            <input
              id="person-reset-pw"
              className="input"
              type="password"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
            />
          </label>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={() => void resetPassword()}
              disabled={resetPw.length < 8}
            >
              Passwort setzen
            </button>
            <button className="btn" onClick={() => setResetFor(null)}>
              Abbrechen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
