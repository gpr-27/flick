import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PopoverMenu } from './PopoverMenu';

const setup = () => {
  const onShare = vi.fn();
  const onOff = vi.fn();
  render(
    <MemoryRouter>
      <PopoverMenu
        label="More"
        icon={<span>+</span>}
        items={[
          { label: 'Share', onClick: onShare },
          { label: 'Off', onClick: onOff, disabled: true },
          { label: 'Settings', to: '/settings' },
        ]}
      />
    </MemoryRouter>,
  );
  return { onShare, onOff };
};

describe('PopoverMenu', () => {
  it('is closed until the trigger is pressed', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('runs the item handler and closes', async () => {
    const { onShare } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not run a disabled item', async () => {
    const { onOff } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Off' }));
    expect(onOff).not.toHaveBeenCalled();
  });

  it('renders link items as links', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('Escape closes it and returns focus to the trigger', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'More' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
