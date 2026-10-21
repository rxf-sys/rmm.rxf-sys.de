import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('always carries a word, never colour alone', () => {
    render(<StatusBadge kind="danger" />);
    expect(screen.getByText('Kritisch')).toBeInTheDocument();
  });

  it('keeps the word for assistive technology when only the icon shows', () => {
    render(<StatusBadge kind="off" iconOnly />);
    expect(screen.getByRole('img', { name: 'Offline' })).toBeInTheDocument();
  });
});
