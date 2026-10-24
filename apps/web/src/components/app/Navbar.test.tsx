import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '@/features/settings/useThemeStore';
import { Navbar } from './Navbar';

vi.mock('@clerk/clerk-react', () => ({ UserButton: () => <button type="button">Account</button> }));

describe('Navbar on phones', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    return { user, menu: screen.getByRole('menu', { name: 'More' }) };
  };

  it('the menu keeps settings and profile reachable', async () => {
    const { menu } = await open();
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('the menu toggles the theme', async () => {
    useThemeStore.setState({ theme: 'light' });
    const { user, menu } = await open();
    await user.click(within(menu).getByRole('menuitem', { name: 'Switch to dark mode' }));
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('Escape closes the menu', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
