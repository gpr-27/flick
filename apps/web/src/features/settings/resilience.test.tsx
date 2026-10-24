import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { fakeApi, installFakeServices } from '../../../test/fakes';
import { ProfilePage } from '../profile/ProfilePage';
import { BlockedUsers } from './components/BlockedUsers';
import { PrivacySettings } from './components/PrivacySettings';

const privacy = {
  last_seen: 'everyone',
  profile_photo: 'everyone',
  about: 'everyone',
  read_receipts: true,
};

describe('PrivacySettings loading and error states', () => {
  it('shows a busy status while loading', () => {
    const api = fakeApi();
    api.call.mockReturnValue(new Promise(() => undefined));
    installFakeServices(undefined, api);
    render(<PrivacySettings />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading your privacy settings')).toBeInTheDocument();
  });

  it('offers a Retry that loads the settings again', async () => {
    const api = fakeApi();
    api.call.mockRejectedValueOnce(new Error('down')).mockResolvedValue(privacy);
    installFakeServices(undefined, api);
    render(<PrivacySettings />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'About' })).toBeInTheDocument();
  });
});

describe('BlockedUsers error state', () => {
  it('offers a Retry when the list cannot be loaded', async () => {
    const api = fakeApi();
    api.call.mockRejectedValueOnce(new Error('down')).mockResolvedValue({
      items: [],
      next_cursor: null,
    });
    installFakeServices(undefined, api);
    render(<BlockedUsers />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.blocks, { query: {} });
  });
});

describe('ProfilePage without a session user', () => {
  beforeEach(() => {
    installFakeServices();
  });

  it('shows a loading status while the profile loads', () => {
    useSessionStore.setState({ user: null, status: 'booting', error: null });
    render(<ProfilePage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error with Retry instead of a blank page', async () => {
    let loads = 0;
    useSessionStore.setState({
      user: null,
      status: 'booting',
      error: "Can't reach the server.",
      load: () => {
        loads += 1;
        return Promise.resolve();
      },
    });
    render(<ProfilePage />);
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(loads).toBe(1);
  });
});
