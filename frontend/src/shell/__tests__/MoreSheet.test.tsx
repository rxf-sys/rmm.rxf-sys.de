import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../../types';
import { MoreSheet } from '../MoreSheet';

const user = { id: 1, username: 'robin', role: 'techniker' } as Account;

function show(onOpenEnroll?: () => void) {
  const onClose = vi.fn<() => void>();
  render(
    <MemoryRouter>
      <MoreSheet user={user} theme="system" onTheme={() => {}} onLogout={() => {}} onClose={onClose} onOpenEnroll={onOpenEnroll} />
    </MemoryRouter>,
  );
  return { onClose };
}

describe('MoreSheet', () => {
  it('offers enrollment on phones to roles that may enroll', async () => {
    const onOpenEnroll = vi.fn<() => void>();
    const { onClose } = show(onOpenEnroll);
    await userEvent.click(screen.getByRole('button', { name: 'Gerät hinzufügen' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenEnroll).toHaveBeenCalled();
  });

  it('leaves it out for everyone else', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Gerät hinzufügen' })).not.toBeInTheDocument();
  });
});
