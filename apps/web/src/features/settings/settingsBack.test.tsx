import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes, BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, installFakeServices } from '../../../test/fakes';
import { resetBackStackForTests } from '@/lib/useBackClose';
import { SettingsPage } from './SettingsPage';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@clerk/clerk-react', () => ({ UserButton: () => null }));

/** Press the phone's Back button and wait for the app to settle. */
const pressBack = async (): Promise<void> => {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
  });
};

describe('Settings: the Back button on a phone', () => {
  beforeEach(() => {
    const api = fakeApi();
    api.call.mockResolvedValue({ items: [] });
    installFakeServices(undefined, api);
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    resetBackStackForTests();
  });

  it('closes the open section first, then leaves Settings', async () => {
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <Link to="/settings">Go to settings</Link>
        <Routes>
          <Route path="/" element={<p>Chat list</p>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>,
    );
    await user.click(screen.getByRole('link', { name: 'Go to settings' }));
    expect(window.location.pathname).toBe('/settings');

    await user.click(await screen.findByRole('button', { name: 'Storage and data' }));
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();

    await pressBack(); // 1st Back: the section closes, we are still in Settings
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Storage and data' })).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe('/settings');

    await pressBack(); // 2nd Back: leaves Settings
    expect(await screen.findByText('Chat list')).toBeInTheDocument();
  });

  it('closing the section with the header arrow leaves no extra history step', async () => {
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <Link to="/settings">Go to settings</Link>
        <Routes>
          <Route path="/" element={<p>Chat list</p>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>,
    );
    await user.click(screen.getByRole('link', { name: 'Go to settings' }));
    await user.click(await screen.findByRole('button', { name: 'Storage and data' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await pressBack(); // goes straight to the chat list
    expect(await screen.findByText('Chat list')).toBeInTheDocument();
  });
});
