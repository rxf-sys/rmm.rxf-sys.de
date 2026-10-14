import './admin.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Pagination } from '../../components/Pagination';
import { roleLabel } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useNow } from '../../hooks/useNow';
import { usePagination } from '../../hooks/usePagination';
import { IconInfo, IconKey, IconPlus, IconPower, IconShield, IconUsers } from '../../icons';
import type { Account, Role } from '../../types';
import { EmptyState, ErrorNote, PageHeader, Panel, SkeletonRows, type MenuEntry } from '../../ui';
import { notify } from '../../ui/toast';
import { CreateAccountDialog, EmailDialog, PasswordDialog } from './AccountDialogs';
import { AccountCards, AccountTable } from './AccountRows';
import { NtfyPanel } from './NtfyPanel';
import { SessionsPanel } from './SessionsPanel';
import { TwoFactorPanel } from './TwoFactorPanel';
import { SELF_LOCK, accountSummary, adminKeys, explain, formatSort, nextSort, parseSort, sortAccounts, type AccountDraft, type SortKey } from './accounts';
import { deleteText, disableText, resetTotpText, roleChangeText } from './confirmations';

interface Props {
  currentUser: Account;
}

type Dialog = { kind: 'create' } | { kind: 'password'; account: Account } | { kind: 'email'; account: Account } | null;
type UpdateBody = Parameters<typeof api.updateAccount>[1];

/** Below this the table becomes a list of cards (DESIGN.md, Datentabelle). */
const CARDS_QUERY = '(max-width: 1000px)';

/** Accounts and roles, the signed-in admin's own second factor and
 *  sessions, and where alarms are pushed. Admins only (App.tsx). */
export function AdminPage({ currentUser }: Props) {
  const qc = useQueryClient();
  const now = useNow();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  // Own second factor when the account list cannot say (not loaded, failed).
  const [ownTotp, setOwnTotp] = useState<boolean | null>(null);
  const asCards = useMediaQuery(CARDS_QUERY);

  // The sort lives in the URL like on the device list: a reload keeps it.
  const [params, setParams] = useSearchParams();
  const rawSort = params.get('sort');
  const sort = useMemo(() => parseSort(rawSort), [rawSort]);
  const onSort = (key: SortKey) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const value = formatSort(nextSort(sort, key));
        if (value) next.set('sort', value);
        else next.delete('sort');
        return next;
      },
      { replace: true },
    );

  const q = useQuery({ queryKey: adminKeys.accounts, queryFn: ({ signal }) => api.accounts(signal).then((r) => r.accounts) });
  const accounts = useMemo(() => q.data ?? [], [q.data]);
  const sorted = useMemo(() => sortAccounts(accounts, sort), [accounts, sort]);
  const pager = usePagination(sorted, 'accounts', `${sort.key}|${sort.dir}`);
  const self = accounts.find((a) => a.id === currentUser.id);
  const totpOn = self?.totp_enabled ?? ownTotp ?? !!currentUser.totp_enabled;

  const reload = () => qc.invalidateQueries({ queryKey: adminKeys.accounts });

  // A deleted row takes its menu button with it — the button the confirm
  // dialog just handed focus back to — and focus would fall to <body>. It
  // moves on to the row that takes its place, the one above, or "Konto
  // anlegen". Set before the request: the reload may render before the
  // await after it resumes.
  const createRef = useRef<HTMLButtonElement>(null);
  const focusAfterDelete = useRef<{ gone: number; to: number | null } | null>(null);
  useEffect(() => {
    const f = focusAfterDelete.current;
    if (!f || accounts.some((x) => x.id === f.gone)) return;
    focusAfterDelete.current = null;
    const row = f.to === null ? null : document.querySelector<HTMLElement>(`[data-account-actions="${f.to}"]`);
    (row ?? createRef.current)?.focus();
  }, [accounts]);
  const mark = (id: number, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** One change to one account, with a toast either way. */
  const update = async (a: Account, body: UpdateBody, done: [string, string], failed: string) => {
    mark(a.id, true);
    try {
      await api.updateAccount(a.id, body);
      await reload();
      notify.success(...done);
    } catch (e) {
      notify.error(failed, explain(e));
    } finally {
      mark(a.id, false);
    }
  };

  const setRoleInList = (id: number, role: Role) =>
    qc.setQueryData<Account[]>(adminKeys.accounts, (list) => list?.map((x) => (x.id === id ? { ...x, role } : x)));

  // The select shows the new role at once and rolls back if the server says
  // no. Disabling it during the request instead would throw keyboard focus
  // out of the table after every change.
  const changeRole = async (a: Account, role: Role) => {
    if (busy.has(a.id)) return;
    const text = roleChangeText(a, role);
    if (text && !(await ask(text))) return;
    // A refetch already under way would bring the old role back mid-change.
    await qc.cancelQueries({ queryKey: adminKeys.accounts });
    setRoleInList(a.id, role);
    mark(a.id, true);
    try {
      await api.updateAccount(a.id, { role });
      notify.success('Rolle geändert', `„${a.username}“ ist jetzt ${roleLabel(role)}.`);
    } catch (e) {
      setRoleInList(a.id, a.role);
      notify.error(`Rolle von „${a.username}“ nicht geändert`, explain(e));
    } finally {
      mark(a.id, false);
      void reload();
    }
  };

  const resetTotp = async (a: Account) => {
    if (!(await ask(resetTotpText(a, a.id === currentUser.id)))) return;
    await update(a, { reset_totp: true }, ['Zwei-Faktor zurückgesetzt', `„${a.username}“ meldet sich bis zur neuen Einrichtung nur mit dem Passwort an.`], 'Zwei-Faktor nicht zurückgesetzt');
  };

  const setDisabled = async (a: Account, disabled: boolean) => {
    if (disabled && !(await ask(disableText(a)))) return;
    await update(
      a,
      { disabled },
      disabled ? ['Konto deaktiviert', `„${a.username}“ ist abgemeldet und kann sich nicht mehr anmelden.`] : ['Konto aktiviert', `„${a.username}“ kann sich wieder anmelden.`],
      disabled ? `„${a.username}“ nicht deaktiviert` : `„${a.username}“ nicht aktiviert`,
    );
  };

  const remove = async (a: Account) => {
    if (!(await ask(deleteText(a)))) return;
    const shown = pager.items;
    const at = shown.findIndex((x) => x.id === a.id);
    focusAfterDelete.current = { gone: a.id, to: (shown[at + 1] ?? shown[at - 1])?.id ?? null };
    mark(a.id, true);
    try {
      await api.deleteAccount(a.id);
      await reload();
      notify.success('Konto gelöscht', `„${a.username}“`);
    } catch (e) {
      focusAfterDelete.current = null;
      notify.error(`„${a.username}“ nicht gelöscht`, explain(e));
    } finally {
      mark(a.id, false);
    }
  };

  // The dialogs keep themselves open on failure: these throw, they show it.
  const create = async (d: AccountDraft) => {
    const r = await api.createAccount({ username: d.username.trim(), password: d.password, role: d.role, email: d.email.trim() || undefined });
    setDialog(null);
    await reload();
    notify.success('Konto angelegt', `„${r.account.username}“ meldet sich als ${roleLabel(r.account.role)} an.`);
  };
  const setPassword = (a: Account) => async (password: string) => {
    await api.updateAccount(a.id, { password });
    setDialog(null);
    notify.success('Passwort gesetzt', `„${a.username}“ meldet sich ab jetzt mit dem neuen Passwort an.`);
  };
  const setEmail = (a: Account) => async (email: string) => {
    await api.updateAccount(a.id, { email });
    setDialog(null);
    await reload();
    notify.success(email ? 'E-Mail gespeichert' : 'E-Mail entfernt', `„${a.username}“`);
  };

  // Own second factor changed in the panel below: the list says so at once.
  const onOwnTotp = (enabled: boolean) => {
    setOwnTotp(enabled);
    qc.setQueryData<Account[]>(adminKeys.accounts, (list) => list?.map((a) => (a.id === currentUser.id ? { ...a, totp_enabled: enabled } : a)));
  };

  const menu = (a: Account): MenuEntry[] => {
    const isSelf = a.id === currentUser.id;
    const locked = isSelf ? { disabled: true, hint: 'eigenes Konto' } : {};
    const entries: MenuEntry[] = [
      { label: 'Passwort setzen …', icon: <IconKey size={14} />, onSelect: () => setDialog({ kind: 'password', account: a }) },
      { label: a.email ? 'E-Mail ändern …' : 'E-Mail hinterlegen …', onSelect: () => setDialog({ kind: 'email', account: a }) },
    ];
    // Only an account with a second factor has one to reset.
    if (a.totp_enabled) entries.push({ label: 'Zwei-Faktor zurücksetzen …', icon: <IconShield size={14} />, onSelect: () => void resetTotp(a) });
    entries.push(
      'separator',
      a.disabled
        ? { label: 'Aktivieren', icon: <IconPower size={14} />, onSelect: () => void setDisabled(a, false) }
        : { label: 'Deaktivieren …', icon: <IconPower size={14} />, ...locked, onSelect: () => void setDisabled(a, true) },
      { label: 'Löschen …', danger: true, ...locked, onSelect: () => void remove(a) },
    );
    return entries;
  };

  const rows = {
    accounts: pager.items,
    selfId: currentUser.id,
    now,
    onRole: (a: Account, role: Role) => void changeRole(a, role),
    menu,
  };

  return (
    <div className="screen ad">
      {confirmDialog}
      <PageHeader
        title="Administration"
        subtitle="Konten und Rollen, deine eigene Anmeldung und wohin Alarme gemeldet werden."
        actions={
          <button ref={createRef} type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
            <IconPlus size={14} /> Konto anlegen
          </button>
        }
      />

      <Panel title="Konten" meta={q.data ? accountSummary(q.data) : undefined} padded={false}>
        {/* A failed refresh keeps the last list (TanStack keeps data on a
            failed refetch); only a list that never loaded gives way to the error. */}
        {q.error && !q.data ? (
          <div className="ad-pad">
            <ErrorNote error={explain(q.error)} onRetry={() => void q.refetch()} />
          </div>
        ) : q.isPending ? (
          <div className="ad-pad">
            <SkeletonRows rows={4} />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState icon={<IconUsers size={20} />} title="Noch keine Konten">
            Ein Konto braucht jeder, der sich am Dashboard anmeldet.
          </EmptyState>
        ) : (
          <>
            {q.error && (
              <div className="ad-pad">
                <ErrorNote error={explain(q.error)} onRetry={() => void q.refetch()} />
              </div>
            )}
            {asCards ? <AccountCards {...rows} /> : <AccountTable {...rows} sort={sort} onSort={onSort} />}
            <Pagination {...pager} label="Konten" />
            <p className="ad-foot">
              <IconInfo size={14} />
              <span>{SELF_LOCK}</span>
            </p>
          </>
        )}
      </Panel>

      <div className="ad-grid">
        <div className="ad-col">
          <TwoFactorPanel username={currentUser.username} enabled={totpOn} onChanged={onOwnTotp} />
          <SessionsPanel now={now} />
        </div>
        <NtfyPanel />
      </div>

      {dialog?.kind === 'create' && <CreateAccountDialog accounts={accounts} onCreate={create} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <PasswordDialog account={dialog.account} onSave={setPassword(dialog.account)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'email' && <EmailDialog account={dialog.account} onSave={setEmail(dialog.account)} onClose={() => setDialog(null)} />}
    </div>
  );
}
