import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api/client';
import { useConfirm } from '../hooks/useConfirm';
import type { Device, Person } from '../types';
import { Dot } from '../ui';
import { deviceState, stateColor } from '../deviceStatus';

interface Props {
  persons: Person[];
  devices: Device[];
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

export function PersonsPage({ persons, devices, isAdmin, onOpenDevice, onRefresh }: Props) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // One stable key per open form: "new", or the id being edited. Focus follows
  // the form when it is revealed — the point autoFocus got right, without
  // moving focus unexpectedly on page load.
  const draftKey = draft ? String(draft.id ?? 'new') : null;
  useEffect(() => {
    if (draftKey !== null) nameRef.current?.focus();
  }, [draftKey]);
  const [error, setError] = useState<string | null>(null);
  // Zugangsdaten des automatisch angelegten Betrachter-Kontos — erscheinen
  // genau einmal nach dem Anlegen (das Passwort ist danach nicht mehr abrufbar).
  const [createdLogin, setCreatedLogin] = useState<{ username: string; password: string } | null>(
    null,
  );

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
      onRefresh();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

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
              Benutzername: <span className="mono" style={{ fontWeight: 700 }}>{createdLogin.username}</span>
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
        <h1 className="page-title">Personen</h1>
        <span className="muted">{persons.length}</span>
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
            />
            <input
              className="input"
              style={{ flex: '1 1 130px' }}
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="Telefon (optional)"
            />
          </div>
          <input
            className="input"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notizen (optional)"
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
        <div className="grid-2">
          {persons.map((p) => {
            const owned = devices.filter((d) => d.person_id === p.id);
            return (
              <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
                <div className="row" style={{ gap: 10, padding: '13px 16px' }}>
                  <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 800, fontSize: 13.5 }}>{p.name}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {[p.email, p.phone].filter(Boolean).join(' · ') || 'keine Kontaktdaten'}
                    </span>
                  </div>
                  <div className="row grow" style={{ marginLeft: 'auto', gap: 6, flex: 'none' }}>
                    <span className="chip">{p.device_count} Gerät{p.device_count === 1 ? '' : 'e'}</span>
                    {isAdmin && (
                      <>
                        <button className="btn btn-sm" onClick={() => setDraft({ ...p })}>
                          Bearbeiten
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => void remove(p)}>
                          Löschen
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {p.notes && (
                  <div className="muted" style={{ padding: '0 16px 10px', fontSize: 11.5 }}>
                    {p.notes}
                  </div>
                )}
                {owned.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--line2)' }}>
                    {owned.map((d) => (
                      <button
                        key={d.id}
                        className="row"
                        style={{
                          gap: 9,
                          padding: '8px 16px',
                          width: '100%',
                          background: 'none',
                          border: 'none',
                          borderBottom: '1px solid var(--line2)',
                          cursor: 'pointer',
                          color: 'var(--tx)',
                          textAlign: 'left',
                          fontSize: 12,
                        }}
                        onClick={() => onOpenDevice(d.id)}
                      >
                        <Dot color={stateColor(deviceState(d))} />
                        <span style={{ fontWeight: 600 }}>{d.hostname}</span>
                        <span className="muted grow" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                          {d.online ? 'online' : 'offline'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
