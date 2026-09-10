import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonDetail } from '../PersonDetail';
import type { Account, Alert, Device, Person } from '../../types';

const person: Person = {
  id: 2,
  name: 'Martina Fuchs',
  email: 'martina@example.de',
  phone: '+49 170 0000000',
  notes: 'Ruft bei Problemen abends an.',
  created_at: 0,
  device_count: 1,
};

function device(over: Partial<Device> = {}): Device {
  return {
    id: 11,
    hostname: 'laptop-mama',
    owner_label: '',
    os: 'windows',
    os_version: '',
    arch: 'amd64',
    agent_version: '1.3.9',
    tags: [],
    heartbeat: {},
    rustdesk_id: '',
    person_id: 2,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
    online: false,
    connected: false,
    agent_update_available: null,
    ...over,
  };
}

const account: Account = {
  id: 5,
  username: 'martina',
  email: null,
  role: 'viewer',
  disabled: false,
  created_at: 1_700_000_000,
  last_login_at: null,
  totp_enabled: false,
  person_id: 2,
};

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 1,
  device_id: 11,
  rule: 'offline',
  message: 'Gerät offline',
  fired_at: 0,
  resolved_at: null,
  notified: true,
  acked_at: null,
  acked_by: '',
  ...over,
});

function renderDetail(over: Partial<Parameters<typeof PersonDetail>[0]> = {}) {
  const devices = [device()];
  return render(
    <PersonDetail
      person={person}
      devices={devices}
      allDevices={devices}
      account={account}
      activity={[]}
      alerts={[alert()]}
      patchSummary={{ '11': { pending: 21, security: 6 } }}
      isAdmin
      onEdit={() => {}}
      onDelete={() => {}}
      onOpenDevice={() => {}}
      onRefresh={() => {}}
      onResetPassword={() => {}}
      {...over}
    />,
  );
}

describe('PersonDetail', () => {
  it('sums the fleet state of that person alone', () => {
    renderDetail();
    // 1 device, none online, 1 open alert, 21 pending patches, 6 of them security.
    expect(screen.getByText('Geräte').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Online').previousSibling).toHaveTextContent('0/1');
    expect(screen.getByText('Offene Alarme').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Updates offen').previousSibling).toHaveTextContent('21');
    expect(screen.getByText('Sicherheit').previousSibling).toHaveTextContent('6');
  });

  it('ignores alerts belonging to somebody else’s device', () => {
    renderDetail({ alerts: [alert({ id: 2, device_id: 99 })] });
    expect(screen.getByText('Offene Alarme').previousSibling).toHaveTextContent('0');
  });

  it('does not count an alert that is already resolved', () => {
    renderDetail({ alerts: [alert({ resolved_at: 123 })] });
    expect(screen.getByText('Offene Alarme').previousSibling).toHaveTextContent('0');
  });

  it('names the account and warns when it has no second factor', () => {
    renderDetail();
    expect(screen.getByText('martina')).toBeInTheDocument();
    expect(screen.getByText('nicht eingerichtet')).toBeInTheDocument();
    expect(
      screen.getByText(/Zwei-Faktor-Anmeldung ist für dieses Konto nicht eingerichtet/),
    ).toBeInTheDocument();
  });

  it('says so when a person cannot log in at all', () => {
    renderDetail({ account: null });
    expect(screen.getByText(/gibt es kein Konto/)).toBeInTheDocument();
  });

  it('hides account and activity from a non-admin', () => {
    renderDetail({ isAdmin: false, activity: null });
    expect(screen.queryByText('Konto')).not.toBeInTheDocument();
    expect(screen.queryByText('Aktivität')).not.toBeInTheDocument();
    // The fleet half stays: that is what a techniker legitimately sees.
    expect(screen.getByText('Zugewiesene Geräte')).toBeInTheDocument();
  });
});
