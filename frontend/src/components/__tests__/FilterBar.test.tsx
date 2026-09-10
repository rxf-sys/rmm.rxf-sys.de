import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar, type FilterOption } from '../FilterBar';

type Id = 'alle' | 'probleme' | 'offline';

const OPTIONS: FilterOption<Id>[] = [
  { id: 'alle', label: 'Alle' },
  { id: 'probleme', label: 'Probleme', count: 4, tone: 'danger' },
  { id: 'offline', label: 'Offline', count: 0 },
];

describe('FilterBar', () => {
  it('exposes the options as one named group of tabs', () => {
    render(<FilterBar options={OPTIONS} value="alle" onChange={() => {}} label="Geräte filtern" />);
    const group = screen.getByRole('tablist', { name: 'Geräte filtern' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Alle/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a count even when it is zero, so an empty filter looks empty', () => {
    render(<FilterBar options={OPTIONS} value="alle" onChange={() => {}} label="Filter" />);
    expect(screen.getByRole('tab', { name: /Offline/ })).toHaveTextContent('0');
  });

  it('reports the clicked option', async () => {
    const onChange = vi.fn();
    render(<FilterBar options={OPTIONS} value="alle" onChange={onChange} label="Filter" />);
    await userEvent.click(screen.getByRole('tab', { name: /Probleme/ }));
    expect(onChange).toHaveBeenCalledWith('probleme');
  });

  it('is a single tab stop and moves the selection with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<FilterBar options={OPTIONS} value="alle" onChange={onChange} label="Filter" />);

    // Only the active option is reachable by Tab.
    expect(screen.getByRole('tab', { name: /Alle/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Probleme/ })).toHaveAttribute('tabindex', '-1');

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Alle/ }));
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('probleme');
  });

  it('wraps around at the ends', async () => {
    const onChange = vi.fn();
    render(<FilterBar options={OPTIONS} value="alle" onChange={onChange} label="Filter" />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('offline');
  });
});
