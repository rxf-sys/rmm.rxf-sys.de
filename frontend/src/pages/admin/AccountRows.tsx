import { formatAgo, formatDateTime, roleLabel } from '../../format';
import { IconChevronDown, IconChevronUp, IconMore, IconSort } from '../../icons';
import type { Account, Role } from '../../types';
import { Menu, StatusBadge, type MenuEntry } from '../../ui';
import { ROLES, type Sort, type SortKey } from './accounts';

interface RowsProps {
  accounts: Account[];
  /** The signed-in admin: their row cannot change its own role. */
  selfId: number;
  now: number;
  onRole: (a: Account, role: Role) => void;
  menu: (a: Account) => MenuEntry[];
}

function RoleControl({ a, self, onRole }: { a: Account; self: boolean; onRole: (a: Account, role: Role) => void }) {
  if (self)
    return (
      <span className="ad-role-self">
        {roleLabel(a.role)}
        <span className="ad-quiet">eigenes Konto</span>
      </span>
    );
  // A column of identical selects needs the account in each name (axe
  // select-name); "Rolle" alone would be read out once per row.
  return (
    <select
      className="input ad-role"
      value={a.role}
      onChange={(e) => onRole(a, e.target.value as Role)}
      aria-label={`Rolle von ${a.username}`}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {roleLabel(r)}
        </option>
      ))}
    </select>
  );
}

function TwoFactor({ a }: { a: Account }) {
  return <StatusBadge kind={a.totp_enabled ? 'ok' : 'neutral'} label={a.totp_enabled ? 'aktiv' : 'aus'} />;
}

function LastLogin({ a, now }: { a: Account; now: number }) {
  if (!a.last_login_at) return <span className="ad-quiet">nie</span>;
  return (
    <time dateTime={new Date(a.last_login_at * 1000).toISOString()} title={formatDateTime(a.last_login_at)}>
      {formatAgo(a.last_login_at, now)}
    </time>
  );
}

function Name({ a, self }: { a: Account; self: boolean }) {
  return (
    <span className="ad-name">
      <span className="ad-user" title={a.username}>
        {a.username}
      </span>
      {self && <span className="chip">Du</span>}
      {a.disabled && <StatusBadge kind="off" label="deaktiviert" />}
    </span>
  );
}

function Actions({ a, menu }: { a: Account; menu: RowsProps['menu'] }) {
  return (
    <Menu
      label={`Aktionen für ${a.username}`}
      items={menu(a)}
      trigger={(t) => (
        <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`Aktionen für ${a.username}`} {...t}>
          <IconMore size={16} />
        </button>
      )}
    />
  );
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Konto', className: 'ad-c-name' },
  { key: 'role', label: 'Rolle', className: 'ad-c-role' },
  { key: 'mail', label: 'E-Mail', className: 'ad-c-mail' },
  { key: 'totp', label: 'Zwei-Faktor', className: 'ad-c-totp' },
  { key: 'login', label: 'Letzte Anmeldung', className: 'ad-c-login' },
];

function SortHeader({ col, sort, onSort }: { col: (typeof COLUMNS)[number]; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === col.key;
  return (
    <th scope="col" className={col.className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={active ? 'th-sort active' : 'th-sort'} onClick={() => onSort(col.key)}>
        {col.label}
        <span className={active ? 'th-ico active' : 'th-ico'} aria-hidden>
          {!active ? <IconSort size={12} /> : sort.dir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
        </span>
      </button>
    </th>
  );
}

/** Accounts as a table. There is no account page to open, so rows are not
 *  links; everything happens in the row. */
export function AccountTable({ accounts, selfId, now, onRole, menu, sort, onSort }: RowsProps & { sort: Sort; onSort: (k: SortKey) => void }) {
  return (
    <div className="dt-wrap">
      <table className="dt ad-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />
            ))}
            <th scope="col" className="ad-c-act">
              <span className="sr-only">Aktionen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const self = a.id === selfId;
            return (
              <tr key={a.id} className={a.disabled ? 'is-off' : undefined}>
                <td className="ad-c-name">
                  <Name a={a} self={self} />
                  {/* Stands in for the e-mail column once the table is too narrow for it. */}
                  <span className="ad-sub-mail">{a.email || 'ohne E-Mail'}</span>
                </td>
                <td className="ad-c-role">
                  <RoleControl a={a} self={self} onRole={onRole} />
                </td>
                <td className="ad-c-mail" title={a.email ?? undefined}>
                  {a.email || <span className="ad-none">—</span>}
                </td>
                <td className="ad-c-totp">
                  <TwoFactor a={a} />
                </td>
                <td className="ad-c-login">
                  <LastLogin a={a} now={now} />
                </td>
                <td className="ad-c-act">
                  <Actions a={a} menu={menu} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The same accounts as cards, for phones. */
export function AccountCards({ accounts, selfId, now, onRole, menu }: RowsProps) {
  return (
    <ul className="ad-cards">
      {accounts.map((a) => {
        const self = a.id === selfId;
        return (
          <li key={a.id} className={a.disabled ? 'ad-card is-off' : 'ad-card'}>
            <div className="ad-card-top">
              <Name a={a} self={self} />
              <Actions a={a} menu={menu} />
            </div>
            {a.email && <span className="ad-card-mail">{a.email}</span>}
            <dl className="ad-card-facts">
              <div>
                <dt>Rolle</dt>
                <dd>
                  <RoleControl a={a} self={self} onRole={onRole} />
                </dd>
              </div>
              <div>
                <dt>Zwei-Faktor</dt>
                <dd>
                  <TwoFactor a={a} />
                </dd>
              </div>
              <div>
                <dt>Letzte Anmeldung</dt>
                <dd>
                  <LastLogin a={a} now={now} />
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
