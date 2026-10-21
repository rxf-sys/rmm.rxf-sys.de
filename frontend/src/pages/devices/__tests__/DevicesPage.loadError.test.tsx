import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { DevicesPage } from '../DevicesPage';

function show(loadError: unknown) {
  const onRetry = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/devices']}>
        <DevicesPage
          devices={[]}
          patchSummary={{}}
          persons={[]}
          loading={false}
          loadError={loadError}
          onRetry={onRetry}
          canOperate
          onOpenEnroll={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onRetry;
}

describe('DevicesPage when the list never arrived', () => {
  it('says so with a retry instead of calling the fleet empty', async () => {
    const onRetry = show(new ApiError(500, 'kaputt'));
    expect(screen.getByRole('alert')).toHaveTextContent('kaputt');
    expect(screen.queryByText('Noch keine Geräte')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerät hinzufügen/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('still invites the first device when the list loaded empty', () => {
    show(null);
    expect(screen.getByText('Noch keine Geräte')).toBeInTheDocument();
  });
});
