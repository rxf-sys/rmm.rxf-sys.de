import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import type { Heartbeat } from '../../../types';
import {
  accountFate,
  explainError,
  initial,
  matchesPerson,
  nameList,
  openAlertsOn,
  personActivity,
  personFacts,
  personRows,
  personVerdict,
  phoneLink,
} from '../personsMeta';
import { account, alert, device, event, person } from './fixtures';

const fullDisk: Heartbeat = { disks: [{ mount: 'C:', used_pct: 95, total_b: 100 }] };

describe('personFacts', () => {
  it('sums the fleet state of that person alone', () => {
    const facts = personFacts([device()], [alert()], { '11': { pending: 21, security: 6 }, '99': { pending: 4, security: 4 } });
    expect(facts).toEqual({ devices: 1, online: 0, openAlerts: 1, pending: 21, security: 6 });
  });

  it('ignores alerts belonging to somebody else’s device', () => {
    expect(personFacts([device()], [alert({ device_id: 99 })], {}).openAlerts).toBe(0);
  });

  it('does not count an alert that is already resolved', () => {
    expect(personFacts([device()], [alert({ resolved_at: 123 })], {}).openAlerts).toBe(0);
  });

  it('lists open alerts newest first', () => {
    const list = openAlertsOn([device()], [alert({ id: 1, fired_at: 10 }), alert({ id: 2, fired_at: 30 })]);
    expect(list.map((a) => a.id)).toEqual([2, 1]);
  });
});

describe('personVerdict', () => {
  const ok = device({ online: true });
  it('puts a critical device above everything else', () => {
    const crit = device({ id: 12, online: true, heartbeat: fullDisk });
    expect(personVerdict([ok, crit, device({ id: 13 })], 2)).toEqual({ kind: 'danger', label: '1 Gerät kritisch' });
  });

  it('ranks an open alert above a device that is merely offline', () => {
    expect(personVerdict([device()], 1)).toEqual({ kind: 'warn', label: '1 offener Alarm' });
    expect(personVerdict([device(), device({ id: 12 })], 0)).toEqual({ kind: 'off', label: '2 Geräte offline' });
  });

  it('is calm when all is well and says so when there is nothing to judge', () => {
    expect(personVerdict([ok], 0)).toEqual({ kind: 'ok', label: 'Alles in Ordnung' });
    expect(personVerdict([], 0).label).toBe('Kein Gerät');
    expect(personVerdict([device({ device_class: 'mobile' })], 0).label).toBe('Nur Geräte ohne Agent');
  });
});

describe('list', () => {
  const rows = personRows(
    [person(), person({ id: 3, name: 'Bernd Adler', email: '', phone: '', notes: '' })],
    [device(), device({ id: 12, hostname: 'drucker', person_id: null })],
    [alert()],
  );

  it('sorts by name and attaches each person’s own devices', () => {
    expect(rows.map((r) => r.person.name)).toEqual(['Bernd Adler', 'Martina Fuchs']);
    expect(rows[1]!.devices.map((d) => d.hostname)).toEqual(['laptop-mama']);
  });

  it('finds a person by the hostname of their device', () => {
    expect(rows.filter((r) => matchesPerson(r, 'LAPTOP', 'alle')).map((r) => r.person.id)).toEqual([2]);
  });

  it('filters for findings and for people without devices', () => {
    expect(rows.filter((r) => matchesPerson(r, '', 'befund')).map((r) => r.person.id)).toEqual([2]);
    expect(rows.filter((r) => matchesPerson(r, '', 'ohne')).map((r) => r.person.id)).toEqual([3]);
  });
});

describe('activity and account', () => {
  it('keeps events of the person’s account and of their devices', () => {
    const events = [
      event({ id: 1, actor: 'martina' }),
      event({ id: 2, actor: 'robin', device_id: 11, event: 'devices.updated' }),
      event({ id: 3, actor: 'robin', device_id: 99 }),
    ];
    expect(personActivity(events, account(), [device()]).map((e) => e.id)).toEqual([1, 2]);
    expect(personActivity(events, null, [device()]).map((e) => e.id)).toEqual([2]);
  });

  it('knows a viewer account is deleted with the person and a higher role only unlinked', () => {
    expect(accountFate(account())).toBe('deleted');
    expect(accountFate(account({ role: 'techniker' }))).toBe('unlinked');
    expect(accountFate(null)).toBeNull();
  });

  it('explains a 403 instead of passing the server’s English through', () => {
    const e = explainError(new ApiError(403, '{"detail":"admin privileges required"}'), 'Personen löschen dürfen nur Administratoren.');
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe('Personen löschen dürfen nur Administratoren.');
    const other = new ApiError(500, 'boom');
    expect(explainError(other, 'x')).toBe(other);
  });
});

describe('wording', () => {
  it('lists names the way a sentence would', () => {
    expect(nameList(['a'])).toBe('a');
    expect(nameList(['a', 'b'])).toBe('a und b');
    expect(nameList(['a', 'b', 'c'])).toBe('a, b und c');
    expect(nameList(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c, d und 2 weitere');
  });

  it('turns a written phone number into a dialable link', () => {
    expect(phoneLink('+49 (170) 123-45 / 6')?.href).toBe('tel:+49170123456');
    expect(phoneLink('0170 1234')?.href).toBe('tel:01701234');
    expect(phoneLink('0711 / 123456')?.href).toBe('tel:0711123456');
    expect(phoneLink('(0711) 123456')?.href).toBe('tel:0711123456');
  });

  it('drops the bracketed trunk zero after a country code', () => {
    expect(phoneLink('+49 (0)711 123456')?.href).toBe('tel:+49711123456');
  });

  it('links only the first of several numbers and keeps the rest as text', () => {
    expect(phoneLink('0711 123456 / 0171 9876543')).toEqual({
      before: '',
      number: '0711 123456',
      after: ' / 0171 9876543',
      href: 'tel:0711123456',
    });
    expect(phoneLink('Büro: 0711 123456, mobil 0171 98765 (abends)')).toEqual({
      before: 'Büro: ',
      number: '0711 123456',
      after: ', mobil 0171 98765 (abends)',
      href: 'tel:0711123456',
    });
    expect(phoneLink('Zi. 4, Tel. 0711 123456')?.href).toBe('tel:0711123456');
  });

  it('links nothing when there is no number to dial', () => {
    expect(phoneLink('nur abends')).toBeNull();
    expect(phoneLink('Zimmer 12')).toBeNull();
  });

  it('takes the whole first character for the avatar', () => {
    expect(initial(' ömer')).toBe('Ö');
    expect(initial('')).toBe('?');
  });
});
