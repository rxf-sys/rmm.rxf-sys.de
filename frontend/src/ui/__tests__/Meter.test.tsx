import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Meter } from '../Meter';

describe('Meter', () => {
  it('is a meter with its value when the device reports one', () => {
    render(<Meter label="CPU" value={42.4} level="ok" />);
    const m = screen.getByRole('meter', { name: 'CPU' });
    expect(m).toHaveAttribute('aria-valuenow', '42');
  });

  it('is no meter at all without a value', () => {
    // role="meter" without aria-valuenow is an axe "critical".
    render(<Meter label="CPU" value={null} level="ok" />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
