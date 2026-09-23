import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DevicesPage } from '../DevicesPage';
import type { Device } from '../../types';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 1,
    hostname: 'buero-pc',
    owner_label: '',
    os: 'windows',
    os_version: '11',
    arch: 'amd64',
    agent_version: '1.4.0',
    tags: [],
    heartbeat: { cpu_pct: 12, mem_pct: 40, disks: [{ mount: 'C:', used_pct: 50, total_b: 512_000_000_000 }] },
    rustdesk_id: '',
    person_id: null,
    maintenance_until: null,
    created_at: 0,
    last_seen_at: 1,
    online: true,
    connected: true,
    agent_update_available: null,
    last_patch_scan_at: 0,
    device_class: 'agent',
    ownership: '',
    model: '',
    serial: '',
    imei: '',
    notes: '',
    checked_at: null,
    ...over,
  };
}

const phone = device({
  id: 2,
  hostname: 'iPhone von Lisa',
  os: 'ios',
  os_version: '18.6',
  online: false,
  connected: false,
  last_seen_at: null,
  device_class: 'mobile',
  ownership: 'private',
  model: 'iPhone 15',
  checked_at: 1_700_000_000,
});

function show(route: string, devices: Device[]) {
  render(
    <MemoryRouter initialEntries={[route]}>
      <DevicesPage
        devices={devices}
        patchSummary={{}}
        persons={[]}
        loading={false}
        onOpenDevice={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('DevicesPage mit Geräten ohne Agent', () => {
  it('zeigt statt Auslastung, was das Gerät ist', () => {
    show('/devices', [phone]);
    expect(screen.getByText(/Ohne Agent · Privatgerät · iPhone 15/)).toBeInTheDocument();
  });

  it('führt ein Telefon nicht unter „Offline"', () => {
    show('/devices?filter=offline', [device(), phone]);
    expect(screen.queryByText('iPhone von Lisa')).not.toBeInTheDocument();
    expect(screen.getByText('Keine Geräte gefunden.')).toBeInTheDocument();
  });

  it('hat einen eigenen Filter für Geräte ohne Agent', () => {
    show('/devices?filter=mobil', [device(), phone]);
    expect(screen.getByText('iPhone von Lisa')).toBeInTheDocument();
    expect(screen.queryByText('buero-pc')).not.toBeInTheDocument();
  });
});
