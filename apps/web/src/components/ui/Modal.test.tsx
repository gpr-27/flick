import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetBackStackForTests } from '@/lib/useBackClose';
import { Modal } from './Modal';

const Harness = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="Example">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Modal>
    </>
  );
};

describe('Modal focus management', () => {
  it('moves focus in, traps Tab, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);

    expect(screen.getByRole('dialog', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab(); // wraps instead of leaving the dialog
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Modal and the phone Back button', () => {
  afterEach(() => {
    resetBackStackForTests();
  });

  it('Back closes the dialog instead of leaving the page', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect((window.history.state as Record<string, unknown>).__flickBack).toBeDefined();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closing with Escape takes the extra history step away', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect((window.history.state as Record<string, unknown>).__flickBack).toBeDefined();
    await user.keyboard('{Escape}');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect((window.history.state as Record<string, unknown> | null)?.__flickBack).toBeUndefined();
  });
});
