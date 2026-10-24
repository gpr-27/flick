import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { BOB, ME, fakeApi, installFakeServices, makeConversation } from '../../../../test/fakes';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useChatStore } from '../useChatStore';
import { ContactInfo } from './ContactInfo';
import { useContactInfo } from './useContactInfo';

const profile = {
  id: BOB,
  username: 'bob',
  display_name: 'Bob',
  avatar_url: null,
  is_bot: false,
  about: 'Hello there',
  last_seen_at: null,
  online: true,
  blocked_by_me: false,
};

const setup = (overrides: object = {}, userId = BOB) => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) =>
    Promise.resolve(
      endpoint === ENDPOINTS.users.profile
        ? { ...profile, ...overrides }
        : endpoint === ENDPOINTS.conversations.createDirect
          ? makeConversation()
          : undefined,
    ),
  );
  installFakeServices(undefined, api);
  const onClose = vi.fn();
  render(<ContactInfo userId={userId} onClose={onClose} />);
  return { api, onClose };
};

describe('ContactInfo', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: {} });
    useSessionStore.setState({ user: null });
  });

  it('shows name, username, about and presence', async () => {
    setup();
    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('Online', { selector: 'p' })).toBeInTheDocument();
  });

  it('leaves out About and last seen when privacy hides them', async () => {
    setup({ about: null, online: false, last_seen_at: null });
    await screen.findByRole('button', { name: 'Message' });
    expect(screen.queryByText('About')).not.toBeInTheDocument();
    expect(screen.queryByText(/last seen/)).not.toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    const api = fakeApi();
    api.call.mockRejectedValueOnce(new Error('x')).mockResolvedValue(profile);
    installFakeServices(undefined, api);
    render(<ContactInfo userId={BOB} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Hello there')).toBeInTheDocument();
  });

  it('blocks and unblocks', async () => {
    const { api } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Block' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.block, { body: { user_id: BOB } });
    await userEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.unblock, {
      params: { user_id: BOB },
    });
  });

  it('opens a direct chat from Message and closes', async () => {
    const { api, onClose } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Message' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.createDirect, {
      body: { user_id: BOB },
    });
  });

  it('opens the report dialog for this person', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('heading', { name: 'Report' })).toBeInTheDocument();
  });

  it('has no actions on my own profile', async () => {
    useSessionStore.setState({ user: { id: ME } as never });
    setup({ id: ME }, ME);
    await screen.findByText('Hello there');
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('useContactInfo opens a person from a tap', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue(profile);
    installFakeServices(undefined, api);
    const Harness = () => {
      const contact = useContactInfo();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              contact.open(BOB);
            }}
          >
            tap
          </button>
          {contact.dialog}
        </>
      );
    };
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'tap' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
