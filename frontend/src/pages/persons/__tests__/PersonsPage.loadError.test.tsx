import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { PersonsPage } from '../PersonsPage';
import { device, person } from './fixtures';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      accounts: () => Promise.resolve({ accounts: [] }),
      audit: () => Promise.resolve({ events: [], total: 0 }),
    },
  };
});

function show(client: QueryClient, persons = [] as ReturnType<typeof person>[]) {
  const onRefresh = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/personen']}>
        <PersonsPage
          persons={persons}
          devices={[device()]}
          alerts={[]}
          patchSummary={{}}
          isAdmin
          onOpenDevice={() => {}}
          onRefresh={onRefresh}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onRefresh;
}

describe('PersonsPage when the persons list failed', () => {
  it('says the list did not load instead of claiming there are no persons', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.prefetchQuery({ queryKey: qk.persons, queryFn: () => Promise.reject(new ApiError(502, 'Bad Gateway')) });
    show(client);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad Gateway');
    expect(screen.queryByText('Noch keine Personen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Person anlegen/ })).not.toBeInTheDocument();
  });

  it('keeps the list it has when only a refresh failed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const martina = person();
    client.setQueryData(qk.persons, [martina]);
    await client
      .fetchQuery({ queryKey: qk.persons, queryFn: () => Promise.reject(new ApiError(502, 'Bad Gateway')), staleTime: 0 })
      .catch(() => {});
    show(client, [martina]);
    expect(screen.getByRole('region', { name: 'Personenliste' })).toHaveTextContent(martina.name);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still shows the empty state for a list that loaded empty', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.persons, []);
    show(client);
    expect(screen.getByText('Noch keine Personen')).toBeInTheDocument();
  });
});
