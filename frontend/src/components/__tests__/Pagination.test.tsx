import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from '../Pagination';

const base = {
  page: 1,
  pageCount: 6,
  pageSize: 25 as const,
  total: 137,
  from: 1,
  to: 25,
  setPage: () => {},
  setPageSize: () => {},
  label: 'Geräte',
};

describe('Pagination', () => {
  it('stays out of the way for a list that fits on one page', () => {
    const { container } = render(
      <Pagination {...base} pageCount={1} total={12} to={12} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the size control for a long list shown as 'alle'", () => {
    render(<Pagination {...base} pageCount={1} pageSize="alle" to={137} />);
    expect(screen.getByLabelText('Geräte pro Seite')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nächste Seite')).not.toBeInTheDocument();
  });

  it('reports the visible range', () => {
    render(<Pagination {...base} />);
    expect(screen.getByText('1–25 von 137')).toBeInTheDocument();
  });

  it('disables the step buttons at the ends', () => {
    const { rerender } = render(<Pagination {...base} />);
    expect(screen.getByLabelText('Vorherige Seite')).toBeDisabled();
    expect(screen.getByLabelText('Nächste Seite')).toBeEnabled();
    rerender(<Pagination {...base} page={6} from={126} to={137} />);
    expect(screen.getByLabelText('Nächste Seite')).toBeDisabled();
  });

  it('marks the current page for assistive tech', () => {
    render(<Pagination {...base} page={3} from={51} to={75} />);
    expect(screen.getByLabelText('Seite 3')).toHaveAttribute('aria-current', 'page');
  });

  it('collapses long page runs instead of rendering every number', () => {
    render(<Pagination {...base} pageCount={40} page={20} />);
    // First, last and a window around the current page — not forty buttons.
    expect(screen.getByLabelText('Seite 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Seite 40')).toBeInTheDocument();
    expect(screen.queryByLabelText('Seite 10')).not.toBeInTheDocument();
    expect(screen.getAllByText('…')).toHaveLength(2);
  });

  it('reports a chosen page size', async () => {
    const setPageSize = vi.fn();
    render(<Pagination {...base} setPageSize={setPageSize} />);
    await userEvent.selectOptions(screen.getByLabelText('Geräte pro Seite'), 'alle');
    expect(setPageSize).toHaveBeenCalledWith('alle');
  });
});
