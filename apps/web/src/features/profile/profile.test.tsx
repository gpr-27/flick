import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS, LIMITS } from '@chat/contracts';
import { useSessionStore, type Me } from '@/features/auth/useSessionStore';
import { presenceLabel } from '@/features/chat/conversationView';
import { BOB, ME, fakeApi, installFakeServices } from '../../../test/fakes';
import { AboutEditor } from './AboutEditor';
import { ProfilePopup } from './ProfilePopup';

const bob = { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false };
const profile = (over: object) => ({
  ...bob,
  about: null,
  last_seen_at: null,
  online: false,
  blocked_by_me: false,
  ...over,
});

describe('ProfilePopup', () => {
  it('shows the about line and last seen', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue(
      profile({ about: 'Hey there, I am on Flick', last_seen_at: '2026-01-01T10:00:00.000Z' }),
    );
    installFakeServices(undefined, api);
    render(<ProfilePopup user={bob} open onClose={() => undefined} />);

    expect(await screen.findByText('Hey there, I am on Flick')).toBeInTheDocument();
    expect(screen.getByText(/last seen/)).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.profile, { params: { user_id: BOB } });
  });

  it('shows no about section and no last seen when the user hides them', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue(profile({}));
    installFakeServices(undefined, api);
    render(<ProfilePopup user={bob} open onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('About')).not.toBeInTheDocument();
    expect(screen.queryByText(/last seen/)).not.toBeInTheDocument();
  });

  it('shows Online for someone who is online', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue(profile({ online: true }));
    installFakeServices(undefined, api);
    render(<ProfilePopup user={bob} open onClose={() => undefined} />);
    expect(await screen.findByText('Online')).toBeInTheDocument();
  });
});

describe('presenceLabel', () => {
  it('never shows "Invalid Date"', () => {
    expect(presenceLabel({ online: false, last_seen_at: 'not a date' })).toBe('');
    expect(presenceLabel({ online: false, last_seen_at: null })).toBe('');
    expect(presenceLabel(undefined)).toBe('');
  });
});

describe('AboutEditor', () => {
  beforeEach(() => {
    useSessionStore.setState({
      user: { id: ME, about: 'old line' } as Me,
      status: 'authenticated',
    });
  });

  it('saves the trimmed line, and an empty line clears it', async () => {
    const api = fakeApi();
    api.call.mockImplementation((_endpoint, args) => {
      const about = (args as { body: { about: string | null } }).body.about;
      return Promise.resolve({ id: ME, about });
    });
    installFakeServices(undefined, api);
    render(<AboutEditor />);

    const field = screen.getByLabelText('About');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '  Busy  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updateMe, { body: { about: 'Busy' } });
    await waitFor(() => {
      expect(useSessionStore.getState().user?.about).toBe('Busy');
    });

    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.call).toHaveBeenLastCalledWith(ENDPOINTS.users.updateMe, { body: { about: null } });
  });

  it('stops typing at the length limit', async () => {
    installFakeServices();
    render(<AboutEditor />);
    const field = screen.getByLabelText('About');
    await userEvent.clear(field);
    await userEvent.type(field, 'x'.repeat(LIMITS.MAX_ABOUT_LENGTH + 20));
    expect((field as HTMLInputElement).value).toHaveLength(LIMITS.MAX_ABOUT_LENGTH);
  });
});
