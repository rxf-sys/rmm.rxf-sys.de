import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertsPage } from '../AlertsPage';
import type { Alert, Device } from '../../types';

vi.mock('../../api/client', () => ({
  api: { ackAlert: () => Promise.resolve({ ok: true }) },
  apiErrorMessage: (e: unknown) => String(e),
}));

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 1,
  device_id: 1,
  rule: 'offline',
  message: 'Gerät meldet sich nicht',
  fired_at: NOW - 60,
  resolved_at: null,
  notified: true,
  acked_at: null,
  acked_by: '',
  ...over,
});

const devices: Device[] = [];

const show = (a: Alert) =>
  render(<AlertsPage alerts={[a]} devices={devices} onOpenDevice={() => {}} onRefresh={() => {}} />);

describe('AlertsPage severity', () => {
  it('treats a fresh outage as a warning, not as a catastrophe', () => {
    show(alert({ fired_at: NOW - 5 * 60 }));
    expect(screen.getByText('warnung')).toBeInTheDocument();
  });

  it('escalates once the device has been gone for a day', () => {
    show(alert({ fired_at: NOW - 30 * HOUR }));
    expect(screen.getByText('kritisch')).toBeInTheDocument();
  });

  it('counts an overdue security patch as critical from the start', () => {
    // Die Regel feuert erst nach ihrer eigenen Frist (Default 30 Tage) —
    // wenn sie feuert, ist nichts mehr frisch daran.
    show(alert({ rule: 'patch_age', message: 'Sicherheitsupdate seit 31 Tagen offen' }));
    expect(screen.getByText('kritisch')).toBeInTheDocument();
  });

  it('falls back to a warning for a rule it does not know', () => {
    show(alert({ rule: 'brandneu', message: 'Etwas Neues' }));
    expect(screen.getByText('warnung')).toBeInTheDocument();
  });
});
