import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from '../useConfirm';

function Harness() {
  const { ask, dialog } = useConfirm();
  const [result, setResult] = useState<string>('—');
  return (
    <div>
      {dialog}
      <button
        onClick={() =>
          void ask({
            title: 'Gerät entfernen',
            body: 'Der Agent verliert seinen Zugang.',
            confirmLabel: 'Endgültig entfernen',
            danger: true,
          }).then((ok) => setResult(ok ? 'bestätigt' : 'abgebrochen'))
        }
      >
        Auslösen
      </button>
      <output>{result}</output>
    </div>
  );
}

describe('useConfirm', () => {
  it('resolves true when confirmed', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Auslösen' }));
    expect(screen.getByRole('dialog', { name: 'Gerät entfernen' })).toBeInTheDocument();
    // The body names the consequence, not "are you sure".
    expect(screen.getByText('Der Agent verliert seinen Zugang.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig entfernen' }));
    expect(await screen.findByText('bestätigt')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when cancelled', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Auslösen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText('abgebrochen')).toBeInTheDocument();
  });

  it('resolves false when dismissed with Escape', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Auslösen' }));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('abgebrochen')).toBeInTheDocument();
  });
});
