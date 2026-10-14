import './persons.css';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { FilterBar, type FilterOption } from '../../components/FilterBar';
import { roleLabel } from '../../format';
import { useConfirm } from '../../hooks/useConfirm';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { IconPlus, IconSearch, IconUsers } from '../../icons';
import type { Alert, Device, PatchSummary, Person } from '../../types';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { PersonDetail } from './PersonDetail';
import { CredentialsDialog, PersonDialog } from './PersonDialogs';
import {
  EMPTY_DRAFT,
  accountFate,
  accountFor,
  draftBody,
  explainError,
  initial,
  isPersonFilter,
  matchesPerson,
  nameList,
  needsAttention,
  personRows,
  plural,
  type Draft,
  type PersonFilter,
  type PersonRow,
} from './personsMeta';
import { ACCOUNTS_KEY, RECENT_AUDIT_KEY, useAccounts, useFirstPersonsLoad } from './personsQueries';

interface Props {
  persons: Person[];
  devices: Device[];
  alerts: Alert[];
  patchSummary: PatchSummary;
  isAdmin: boolean;
  onOpenDevice: (id: number) => void;
  onRefresh: () => void;
}

/** Below this the list and the detail no longer fit side by side. */
const STACKED = '(max-width: 1000px)';

/**
 * People and their devices as list and detail: pick a person on the left,
 * see their devices, alerts, updates and account on the right. The
 * selection lives in the URL (`?person=`), so a person can be linked and the
 * back button closes the detail on a phone.
 */
export function PersonsPage({ persons, devices, alerts, patchSummary, isAdmin, onOpenDevice, onRefresh }: Props) {
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('person')) || null;
  const rawFilter = params.get('filter');
  const filter: PersonFilter = isPersonFilter(rawFilter) ? rawFilter : 'alle';
  // The search text stays component state: an input controlled by the URL
  // drops keystrokes, because React Router applies URL changes in a transition.
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const searchId = useId();
  const stacked = useMediaQuery(STACKED);
  const loading = useFirstPersonsLoad();
  const accountsQ = useAccounts(isAdmin);

  const setParam = (patch: Record<string, string | null>, replace: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace },
    );
  // Selecting pushes a history entry, so "back" on a phone returns to the list.
  const select = (id: number | null) => setParam({ person: id === null ? null : String(id) }, false);

  const rows = useMemo(() => personRows(persons, devices, alerts), [persons, devices, alerts]);
  const visible = rows.filter((r) => matchesPerson(r, q, filter));
  // Each count says what a click would show, given the search.
  const filterOptions: FilterOption<PersonFilter>[] = [
    { id: 'alle', label: 'Alle' },
    { id: 'befund', label: 'Mit Befund', count: rows.filter((r) => matchesPerson(r, q, 'befund')).length, tone: 'warn' },
    { id: 'ohne', label: 'Ohne Gerät', count: rows.filter((r) => matchesPerson(r, q, 'ohne')).length },
  ];
  const chosen = rows.find((r) => r.person.id === selectedId) ?? null;
  // Side by side, the detail is never blank while the list shows someone.
  const shown = chosen ?? (stacked ? null : (visible[0] ?? null));

  const accounts = accountsQ.data;
  const assigned = devices.filter((d) => d.person_id !== null).length;
  const viewers = accounts?.filter((a) => a.role === 'viewer' && a.person_id != null).length;
  const subtitle = [
    `${assigned} von ${plural(devices.length, 'Gerät', 'Geräten')} zugewiesen`,
    viewers !== undefined ? plural(viewers, 'Betrachter-Konto', 'Betrachter-Konten') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const afterChange = () => {
    onRefresh();
    void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    void qc.invalidateQueries({ queryKey: RECENT_AUDIT_KEY });
  };

  const save = async (d: Draft) => {
    const body = draftBody(d);
    try {
      if (d.id === null) {
        const r = await api.createPerson(body);
        // The list arrives as a prop from the fleet query. Putting the
        // server's answer there at once lets the new person be selected
        // before the refetch lands.
        qc.setQueryData<Person[]>(qk.persons, (old) => (old ? [...old, r.person] : old));
        setEditing(null);
        select(r.person.id);
        if (r.account && r.initial_password) setCreated({ name: r.person.name, username: r.account.username, password: r.initial_password });
        else notify.warning('Person angelegt, ohne Konto', 'Der Server konnte kein Betrachter-Konto anlegen. Die Geräte der Person werden trotzdem überwacht.');
      } else {
        const r = await api.updatePerson(d.id, body);
        qc.setQueryData<Person[]>(qk.persons, (old) => old?.map((p) => (p.id === r.person.id ? r.person : p)));
        setEditing(null);
        notify.success('Gespeichert', r.person.name);
      }
      afterChange();
    } catch (e) {
      notify.error('Nicht gespeichert', explainError(e, 'Personen anlegen und ändern dürfen nur Administratoren.'));
    }
  };

  const remove = async (row: PersonRow) => {
    const p = row.person;
    const account = accountFor(accounts, p.id);
    const fate = accountFate(account);
    const n = row.devices.length;
    const ok = await ask({
      title: `${p.name} löschen?`,
      body: (
        <>
          <p>
            {n === 0 ? (
              'Dieser Person ist kein Gerät zugewiesen.'
            ) : (
              <>
                {n === 1 ? 'Das zugewiesene Gerät ' : `Die ${n} zugewiesenen Geräte `}
                <b>{nameList(row.devices.map((d) => d.hostname))}</b>
                {n === 1
                  ? ' bleibt in der Flotte und wird weiter überwacht, ist danach aber keiner Person mehr zugewiesen.'
                  : ' bleiben in der Flotte und werden weiter überwacht, sind danach aber keiner Person mehr zugewiesen.'}
              </>
            )}
          </p>
          {fate === 'deleted' && <p>Das Betrachter-Konto „{account!.username}“ wird mitgelöscht; mit ihm kann sich danach niemand mehr anmelden.</p>}
          {fate === 'unlinked' && (
            <p>
              Das Konto „{account!.username}“ ({roleLabel(account!.role)}) bleibt bestehen und wird nur von der Person gelöst.
            </p>
          )}
          {fate === null && accounts === undefined && <p>Ein verknüpftes Betrachter-Konto wird mitgelöscht.</p>}
        </>
      ),
      confirmLabel: 'Person löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePerson(p.id);
      qc.setQueryData<Person[]>(qk.persons, (old) => old?.filter((x) => x.id !== p.id));
      if (selectedId === p.id) setParam({ person: null }, true);
      notify.success('Person gelöscht', p.name);
      afterChange();
    } catch (e) {
      notify.error('Nicht gelöscht', explainError(e, 'Personen löschen dürfen nur Administratoren.'));
    }
  };

  const narrowed = q.trim() !== '' || filter !== 'alle';

  return (
    <div className="screen pn">
      {confirmDialog}
      <PageHeader
        title="Personen"
        count={loading ? undefined : persons.length}
        subtitle={loading || persons.length === 0 ? undefined : subtitle}
        actions={
          isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
              <IconPlus size={14} /> Neue Person
            </button>
          )
        }
      />

      {loading ? (
        <SkeletonRows rows={5} />
      ) : persons.length === 0 ? (
        <EmptyState
          icon={<IconUsers size={22} />}
          title="Noch keine Personen"
          actions={
            isAdmin && (
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                <IconPlus size={14} /> Person anlegen
              </button>
            )
          }
        >
          {isAdmin
            ? 'Personen sind die Menschen hinter den Geräten — Familie oder Kunden. Jede bekommt ein Betrachter-Konto, das nur ihre eigenen Geräte sieht; Geräteliste und Alarmregeln lassen sich nach Person filtern.'
            : 'Ein Administrator legt Personen an und weist ihnen Geräte zu.'}
        </EmptyState>
      ) : (
        <div className="pn-layout">
          {!(stacked && chosen) && (
            <section className="pn-list" aria-label="Personenliste">
              <div className="pn-search">
                <IconSearch size={14} />
                <label htmlFor={searchId} className="sr-only">
                  Personen durchsuchen
                </label>
                <input
                  id={searchId}
                  type="search"
                  className="input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, Kontakt, Hostname …"
                />
              </div>
              <FilterBar options={filterOptions} value={filter} onChange={(f) => setParam({ filter: f === 'alle' ? null : f }, true)} label="Personen filtern" />
              {visible.length === 0 ? (
                <p className="pn-none">
                  Keine Person passt zu {q.trim() ? 'Suche und Filter' : 'diesem Filter'}.{' '}
                  {narrowed && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setQ('');
                        setParam({ filter: null }, true);
                      }}
                    >
                      Zurücksetzen
                    </button>
                  )}
                </p>
              ) : (
                <ul className="pn-items">
                  {visible.map((r) => {
                    const p = r.person;
                    const active = shown?.person.id === p.id;
                    const online = r.devices.filter((d) => d.online).length;
                    const account = accountFor(accounts, p.id);
                    // The same test as the „Mit Befund“ filter: an icon here
                    // promises the person is listed there. Offline alone is not
                    // a finding; the line above already says how many are online.
                    const flagged = needsAttention(r.verdict);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={active ? 'pn-item is-active' : 'pn-item'}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => select(p.id)}
                        >
                          <span className="pn-avatar" aria-hidden>
                            {initial(p.name)}
                          </span>
                          <span className="pn-item-text">
                            <span className="pn-item-name">{p.name}</span>
                            <span className="pn-item-meta">
                              {r.devices.length === 0 ? 'Kein Gerät' : `${plural(r.devices.length, 'Gerät', 'Geräte')} · ${online} online`}
                            </span>
                          </span>
                          {account && account.role !== 'viewer' && <span className="chip">{roleLabel(account.role)}</span>}
                          {flagged && <StatusBadge kind={r.verdict.kind} label={r.verdict.label} iconOnly />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {(!stacked || chosen) && (
            <div className="pn-main">
              {shown ? (
                <PersonDetail
                  key={shown.person.id}
                  person={shown.person}
                  devices={shown.devices}
                  allDevices={devices}
                  persons={persons}
                  alerts={alerts}
                  patchSummary={patchSummary}
                  isAdmin={isAdmin}
                  focusOnMount={stacked}
                  onEdit={() => {
                    const { id, name, email, phone, notes } = shown.person;
                    setEditing({ id, name, email, phone, notes });
                  }}
                  onDelete={() => void remove(shown)}
                  onBack={() => select(null)}
                  onOpenDevice={onOpenDevice}
                  onChanged={onRefresh}
                />
              ) : (
                <EmptyState icon={<IconUsers size={22} />} title="Person wählen">
                  Links eine Person auswählen, um ihre Geräte, Alarme und Kontaktdaten zu sehen.
                </EmptyState>
              )}
            </div>
          )}
        </div>
      )}

      {editing && <PersonDialog key={editing.id ?? 'new'} draft={editing} onSave={save} onClose={() => setEditing(null)} />}
      {created && <CredentialsDialog {...created} onClose={() => setCreated(null)} />}
    </div>
  );
}
