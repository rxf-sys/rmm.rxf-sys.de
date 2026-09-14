import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceTabs } from '../DeviceTabs';

type Id = 'overview' | 'history' | 'patches';

const tabs = [
  { id: 'overview' as const, label: 'Übersicht' },
  { id: 'history' as const, label: 'Verlauf' },
  { id: 'patches' as const, label: 'Updates', count: 23, tone: 'danger' as const },
];

const show = (value: Id, onChange = vi.fn<(id: Id) => void>()) => {
  render(<DeviceTabs tabs={tabs} value={value} onChange={onChange} label="Ansicht dieses Geräts" />);
  return onChange;
};

describe('DeviceTabs', () => {
  it('is one named group, not eight loose buttons', () => {
    show('overview');
    expect(screen.getByRole('tablist', { name: 'Ansicht dieses Geräts' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Übersicht' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is a single tab stop: only the active tab is reachable with Tab', () => {
    show('history');
    expect(screen.getByRole('tab', { name: 'Verlauf' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Übersicht' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys', async () => {
    const onChange = show('overview');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('wraps around at the ends', async () => {
    const onChange = show('overview');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('patches');
  });

  it('shows a count only where there is something to see', () => {
    show('overview');
    // 23 offene Updates gehören an den Reiter; „Verlauf" trägt keine Zahl.
    expect(screen.getByRole('tab', { name: /Updates/ })).toHaveTextContent('23');
    expect(screen.getByRole('tab', { name: 'Verlauf' })).not.toHaveTextContent(/\d/);
  });

  it('hides a zero instead of drawing attention to it', () => {
    render(
      <DeviceTabs
        tabs={[{ id: 'patches' as const, label: 'Updates', count: 0 }]}
        value="patches"
        onChange={() => {}}
        label="Test"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Updates' })).not.toHaveTextContent('0');
  });
});
