import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/features/chat/useChatStore';
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

describe('Navbar with a chat open', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Navbar />
      </MemoryRouter>,
    );

  it('steps aside on phones while a chat is open, so there is no second bar above the chat header', () => {
    useChatStore.setState({ selectedId: 'some-chat' });
    renderAt('/');
    expect(screen.getByRole('banner', { hidden: true })).toHaveClass('max-sm:hidden');
  });

  it('is back when no chat is open', () => {
    useChatStore.setState({ selectedId: null });
    renderAt('/');
    expect(screen.getByRole('banner')).not.toHaveClass('max-sm:hidden');
  });

  it('stays on other pages even if a chat was open, since those pages have no header of their own', () => {
    useChatStore.setState({ selectedId: 'some-chat' });
    renderAt('/settings');
    expect(screen.getByRole('banner')).not.toHaveClass('max-sm:hidden');
  });
});

describe('Navbar Calendar link', () => {
  it('has a direct Calendar link in the main navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Navbar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Calendar', hidden: true })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });
});
