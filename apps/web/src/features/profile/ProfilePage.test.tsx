import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubNavigator } from '../../../test/stubNavigator';
import { ENDPOINTS } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { ApiError } from '@/lib/api';
import { BOB, ME, fakeApi, installFakeServices } from '../../../test/fakes';
import { useSessionStore, type Me } from '../auth/useSessionStore';
import { useChatStore } from '../chat/useChatStore';
import { ProfilePage } from './ProfilePage';
import { PublicProfilePage } from './PublicProfilePage';
import { USERNAME_DEBOUNCE_MS } from './useUsernameCheck';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@clerk/clerk-react', () => ({
  UserButton: () => <span>Account menu</span>,
  // No sign-in photo in these tests: the photo menu only offers "Use my sign-in photo" with one.
  useUser: () => ({ user: { hasImage: false, imageUrl: '' } }),
}));

const me: Me = {
  id: ME,
  username: 'sam',
  email: 'sam@example.com',
  display_name: 'Sam Rao',
  about: null,
  avatar_url: null,
  is_demo: false,
  created_at: '2026-01-15T00:00:00.000Z',
};

let api: ReturnType<typeof fakeApi>;
let availability: { available: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  availability = { available: true };
  api = fakeApi();
  api.call.mockImplementation((endpoint, args) => {
    if (endpoint === ENDPOINTS.users.stats)
      return Promise.resolve({ chats: 4, groups: 2, days_on_flick: 9, last_active_at: null });
    if (endpoint === ENDPOINTS.users.usernameAvailable) return Promise.resolve(availability);
    if (endpoint === ENDPOINTS.users.updateMe)
      return Promise.resolve({ ...me, ...(args as { body: object }).body });
    return Promise.resolve(undefined);
  });
  installFakeServices(undefined, api);
  useSessionStore.setState({ status: 'authenticated', user: me });
});
afterEach(() => {
  vi.useRealTimers();
});

const view = () =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route
          path="/profile"
          element={
            <>
              <Link to="/settings">Go to settings</Link>
              <ProfilePage />
            </>
          }
        />
        <Route path="/settings" element={<p>Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );

const name = () => screen.getByLabelText('Display name');
const username = () => screen.getByLabelText('Username');
const about = () => screen.getByLabelText('About');
const save = () => screen.getByRole('button', { name: 'Save' });
const calls = (endpoint: unknown) => api.call.mock.calls.filter(([e]) => e === endpoint);

describe('the page', () => {
  it('shows the profile, the stats, the read-only details and the completeness', async () => {
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Sam Rao' })).toBeInTheDocument();
    expect(screen.getByText('@sam')).toBeInTheDocument();
    expect(await screen.findByText('9')).toBeInTheDocument(); // days on Flick
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('sam@example.com')).toBeInTheDocument();
    expect(screen.getByText('Member since').nextSibling).toHaveTextContent(/2026/);
    expect(screen.getByRole('progressbar', { name: 'Profile completeness' })).toHaveAttribute(
      'value',
      '33', // only the name counts (no photo, no About)
    );
    expect(screen.getByText(/Add a photo/)).toBeInTheDocument();
  });

  it('Save is off until something changes', () => {
    view();
    expect(save()).toBeDisabled();
  });
});

describe('validation, live', () => {
  it('display name', () => {
    view();
    fireEvent.change(name(), { target: { value: '   ' } });
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(name(), { target: { value: 'Sam R' } });
    expect(save()).toBeEnabled();
    fireEvent.change(name(), { target: { value: 'x'.repeat(70) } });
    expect(screen.getByText(/at most 64/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('username format', () => {
    view();
    fireEvent.change(username(), { target: { value: 'a b' } });
    expect(screen.getByText(/Only letters, numbers/)).toBeInTheDocument();
    fireEvent.change(username(), { target: { value: 'ab' } });
    expect(screen.getByText(/at least 3/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(calls(ENDPOINTS.users.usernameAvailable)).toHaveLength(0);
  });

  it('About counts characters out of 139 and refuses more', () => {
    view();
    fireEvent.change(about(), { target: { value: 'hello' } });
    expect(screen.getByText('5/139')).toBeInTheDocument();
    fireEvent.change(about(), { target: { value: 'x'.repeat(140) } });
    expect(screen.getByText(/140\/139/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('a status chip fills About', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: 'In a meeting' }));
    expect(about()).toHaveValue('In a meeting');
    expect(screen.getByRole('group', { name: 'Quick statuses' }).children).toHaveLength(7);
  });
});

describe('username availability (debounced)', () => {
  const type = (value: string) => {
    fireEvent.change(username(), { target: { value } });
  };
  const wait = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('asks once, only after typing stops', async () => {
    vi.useFakeTimers();
    view();
    type('new');
    await wait(100);
    type('newn');
    await wait(100);
    type('newname');
    expect(screen.getByText('Checking...')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    await wait(USERNAME_DEBOUNCE_MS - 1);
    expect(calls(ENDPOINTS.users.usernameAvailable)).toHaveLength(0);
    await wait(2);
    const asked = calls(ENDPOINTS.users.usernameAvailable);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[1]).toEqual({ query: { u: 'newname' } });
    expect(screen.getByRole('status')).toHaveTextContent('Available');
    expect(save()).toBeEnabled();
  });

  it('says when it is taken and blocks saving', async () => {
    vi.useFakeTimers();
    availability = { available: false };
    view();
    type('bobby');
    await wait(USERNAME_DEBOUNCE_MS + 1);
    expect(screen.getByText('That username is taken.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('does not ask about your own username (any case)', async () => {
    vi.useFakeTimers();
    view();
    type('SAM');
    await wait(USERNAME_DEBOUNCE_MS + 1);
    expect(calls(ENDPOINTS.users.usernameAvailable)).toHaveLength(0);
  });
});

describe('saving', () => {
  it('sends only what changed, shows a toast, updates the session', async () => {
    view();
    fireEvent.change(name(), { target: { value: 'Sam Rao II' } });
    fireEvent.change(about(), { target: { value: 'Busy' } });
    await userEvent.click(save());
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Profile saved.');
    });
    expect(calls(ENDPOINTS.users.updateMe)[0]?.[1]).toEqual({
      body: { display_name: 'Sam Rao II', about: 'Busy' },
    });
    expect(useSessionStore.getState().user).toMatchObject({
      display_name: 'Sam Rao II',
      about: 'Busy',
    });
    expect(save()).toBeDisabled(); // nothing left to save
  });

  it('keeps name edits on Flick only: no sign-in account copy, no note about it', async () => {
    view();
    expect(screen.queryByText(/updates your sign-in account/)).not.toBeInTheDocument();
    fireEvent.change(name(), { target: { value: 'Sam Rao II' } });
    await userEvent.click(save());
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Profile saved.');
    });
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('a taken username on save (409) shows a clear message and keeps the old profile', async () => {
    api.call.mockImplementation((endpoint) => {
      if (endpoint === ENDPOINTS.users.updateMe)
        return Promise.reject(
          new ApiError({ status: 409, code: 'CONFLICT', message: 'That username is taken' }),
        );
      if (endpoint === ENDPOINTS.users.usernameAvailable)
        return Promise.resolve({ available: true });
      return Promise.resolve({ chats: 0, groups: 0, days_on_flick: 1, last_active_at: null });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    view();
    fireEvent.change(name(), { target: { value: 'Changed' } });
    fireEvent.change(username(), { target: { value: 'taken_one' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USERNAME_DEBOUNCE_MS + 1);
    });
    fireEvent.click(save());
    expect(await screen.findByText('That username is taken. Try another one.')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toEqual(me); // rolled back
    expect(name()).toHaveValue('Changed'); // the person's edits are not lost
  });

  it('another error rolls the profile back and says so', async () => {
    api.call.mockImplementation((endpoint) =>
      endpoint === ENDPOINTS.users.updateMe
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ chats: 0, groups: 0, days_on_flick: 1, last_active_at: null }),
    );
    view();
    fireEvent.change(about(), { target: { value: 'Hello' } });
    await userEvent.click(save());
    await waitFor(() => {
      expect(notify.error).toHaveBeenCalled();
    });
    expect(useSessionStore.getState().user).toEqual(me);
  });

  it('removing the photo is saved as a removal', async () => {
    useSessionStore.setState({ user: { ...me, avatar_url: 'https://img/me.png' } });
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Change photo' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove photo' }));
    expect(screen.getByRole('img', { name: 'Sam Rao' })).toHaveAttribute('src', '/avatar.png'); // instant
    await userEvent.click(save());
    await waitFor(() => {
      expect(calls(ENDPOINTS.users.updateMe)[0]?.[1]).toEqual({
        body: { avatar_attachment_id: null },
      });
    });
  });

  it('refuses a file that is not a picture', () => {
    view();
    const input = screen.getByLabelText('Choose a photo', { selector: 'input' });
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(notify.error).toHaveBeenCalledWith('Please pick a picture.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a picture opens the crop dialog', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    view();
    const input = screen.getByLabelText('Choose a photo', { selector: 'input' });
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] },
    });
    expect(screen.getByRole('dialog', { name: 'Crop your photo' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('sharing', () => {
  it('copies the profile link when the browser cannot share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share: undefined, clipboard: { writeText } });
    view();
    await userEvent.click(screen.getByRole('button', { name: /Share profile/ }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/u/sam`);
    expect(notify.success).toHaveBeenCalledWith('Profile link copied.');
    vi.unstubAllGlobals();
  });

  it('copies the @username', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    view();
    await userEvent.click(screen.getByRole('button', { name: /Copy @username/ }));
    expect(writeText).toHaveBeenCalledWith('@sam');
    vi.unstubAllGlobals();
  });
});

describe('unsaved changes guard', () => {
  it('asks before a link inside the app is followed, and lets you stay or leave', async () => {
    const user = userEvent.setup();
    view();
    fireEvent.change(about(), { target: { value: 'half written' } });

    await user.click(screen.getByRole('link', { name: 'Go to settings' }));
    expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    expect(screen.queryByText('Settings page')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(about()).toHaveValue('half written');

    await user.click(screen.getByRole('link', { name: 'Go to settings' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Settings page')).toBeInTheDocument();
  });

  it('does not ask when nothing changed', async () => {
    view();
    await userEvent.click(screen.getByRole('link', { name: 'Go to settings' }));
    expect(await screen.findByText('Settings page')).toBeInTheDocument();
  });

  it('asks the browser before the tab is closed, only while there are changes', () => {
    view();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(about(), { target: { value: 'x' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe('public profile (/u/:username)', () => {
  const page = (username: string) =>
    render(
      <MemoryRouter initialEntries={[`/u/${username}`]}>
        <Routes>
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the person and opens a chat with the Message button', async () => {
    const openDirect = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ openDirect });
    api.call.mockResolvedValue({
      id: BOB,
      username: 'bob',
      display_name: 'Bob B',
      avatar_url: null,
      is_bot: false,
      about: 'Hi, I am Bob',
      last_seen_at: null,
      online: false,
      blocked_by_me: false,
    });
    page('bob');
    expect(await screen.findByRole('heading', { name: 'Bob B' })).toBeInTheDocument();
    expect(screen.getByText('Hi, I am Bob')).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.byUsername, {
      params: { username: 'bob' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Message' }));
    expect(openDirect).toHaveBeenCalledWith(BOB);
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('has no Message button on your own profile', async () => {
    api.call.mockResolvedValue({
      id: ME,
      username: 'sam',
      display_name: 'Sam Rao',
      avatar_url: null,
      is_bot: false,
      about: null,
      last_seen_at: null,
      online: false,
      blocked_by_me: false,
    });
    page('sam');
    await screen.findByRole('heading', { name: 'Sam Rao' });
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('says so when the person cannot be found', async () => {
    api.call.mockRejectedValue(
      new ApiError({ status: 404, code: 'NOT_FOUND', message: 'User not found' }),
    );
    page('ghost');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not find');
  });
});
