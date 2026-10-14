import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { roleLabel } from '../../format';
import { IconEye } from '../../icons';
import type { Account } from '../../types';
import { ErrorNote } from '../../ui';
import { EMPTY_DRAFT, MIN_PASSWORD, ROLES, ROLE_HINT, draftReady, explain, nameTaken, passwordHint, passwordShortfall, type AccountDraft } from './accounts';

/** Submit state shared by the dialogs: a failed request keeps the dialog
 *  open with the server's reason, so nothing typed is lost. */
function useSubmit<T>(run: (value: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (value: T) => {
    setBusy(true);
    setError(null);
    try {
      await run(value);
    } catch (e) {
      setError(explain(e));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function Actions({ onClose, label, disabled }: { onClose: () => void; label: string; disabled: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onClose}>
        Abbrechen
      </button>
      <button type="submit" className="btn btn-primary" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

/** A new password, readable on request: whoever sets it has to pass it on. */
function PasswordField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="ad-pw">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          minLength={MIN_PASSWORD}
          maxLength={256}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
        />
        {/* The label itself says the state; aria-pressed on top would make
            a screen reader announce it twice ("Verbergen, gedrückt"). */}
        <button type="button" className="btn ad-pw-toggle" aria-controls={id} onClick={() => setShown((s) => !s)}>
          <IconEye size={14} /> {shown ? 'Verbergen' : 'Anzeigen'}
        </button>
      </div>
      <span className="field-hint" id={`${id}-hint`}>
        {passwordHint(value)} {hint}
      </span>
    </div>
  );
}

export function CreateAccountDialog({
  accounts,
  onCreate,
  onClose,
}: {
  accounts: Account[];
  onCreate: (d: AccountDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<AccountDraft>(EMPTY_DRAFT);
  const { busy, error, submit } = useSubmit(onCreate);
  const id = useId();
  const taken = nameTaken(d.username, accounts);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (draftReady(d, accounts) && !busy) void submit(d);
  };
  return (
    <Modal title="Konto anlegen" onClose={onClose}>
      {/* noValidate: type=email stays for the phone keyboard, but the
          browser's e-mail grammar refuses "jürgen@firma.de", which the
          server stores. Name and password are checked by draftReady. */}
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <div className="form-2">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-name`}>
              Benutzername
            </label>
            <input
              id={`${id}-name`}
              className="input"
              autoComplete="off"
              spellCheck={false}
              maxLength={120}
              value={d.username}
              onChange={(e) => setD({ ...d, username: e.target.value })}
              aria-invalid={taken}
              aria-describedby={taken ? `${id}-name-err` : undefined}
            />
            {taken && (
              <span className="field-error" id={`${id}-name-err`}>
                „{d.username.trim()}“ gibt es schon.
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-mail`}>
              E-Mail <span className="ad-optional">optional</span>
            </label>
            <input
              id={`${id}-mail`}
              className="input"
              type="email"
              autoComplete="off"
              maxLength={200}
              value={d.email}
              onChange={(e) => setD({ ...d, email: e.target.value })}
            />
          </div>
        </div>
        <PasswordField
          label="Passwort"
          value={d.password}
          onChange={(password) => setD({ ...d, password })}
          hint="Die Person meldet sich damit zum ersten Mal an."
        />
        <div className="field">
          <fieldset className="choice-group" aria-describedby={`${id}-role-hint`}>
            <legend className="field-label">Rolle</legend>
            {ROLES.map((r) => (
              <label key={r} className="choice">
                <input type="radio" name={`${id}-role`} value={r} checked={d.role === r} onChange={() => setD({ ...d, role: r })} />
                {roleLabel(r)}
              </label>
            ))}
          </fieldset>
          <span className="field-hint" id={`${id}-role-hint`}>
            {ROLE_HINT[d.role]}
          </span>
        </div>
        <ErrorNote error={error} />
        <Actions onClose={onClose} label="Konto anlegen" disabled={busy || !draftReady(d, accounts)} />
      </form>
    </Modal>
  );
}

export function PasswordDialog({ account, onSave, onClose }: { account: Account; onSave: (password: string) => Promise<void>; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const { busy, error, submit } = useSubmit(onSave);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (passwordShortfall(pw) === 0 && !busy) void submit(pw);
  };
  return (
    <Modal title={`Neues Passwort für „${account.username}“`} onClose={onClose}>
      <form className="form-stack" onSubmit={onSubmit}>
        <PasswordField
          label="Neues Passwort"
          value={pw}
          onChange={setPw}
          hint={`Offene Sitzungen von „${account.username}“ bleiben angemeldet — Deaktivieren beendet sie.`}
        />
        <ErrorNote error={error} />
        <Actions onClose={onClose} label="Passwort setzen" disabled={busy || passwordShortfall(pw) > 0} />
      </form>
    </Modal>
  );
}

export function EmailDialog({ account, onSave, onClose }: { account: Account; onSave: (email: string) => Promise<void>; onClose: () => void }) {
  const [mail, setMail] = useState(account.email ?? '');
  const { busy, error, submit } = useSubmit(onSave);
  const id = useId();
  const unchanged = mail.trim() === (account.email ?? '');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!unchanged && !busy) void submit(mail.trim());
  };
  return (
    <Modal title={`E-Mail von „${account.username}“`} onClose={onClose}>
      {/* noValidate: as in CreateAccountDialog, the server is the judge. */}
      <form className="form-stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={id}>
            E-Mail-Adresse
          </label>
          <input
            id={id}
            className="input"
            type="email"
            autoComplete="off"
            maxLength={200}
            value={mail}
            onChange={(e) => setMail(e.target.value)}
            aria-describedby={`${id}-hint`}
          />
          <span className="field-hint" id={`${id}-hint`}>
            Leer lassen, um die Adresse zu entfernen.
          </span>
        </div>
        <ErrorNote error={error} />
        <Actions onClose={onClose} label="Speichern" disabled={busy || unchanged} />
      </form>
    </Modal>
  );
}
