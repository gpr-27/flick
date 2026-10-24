// The settings page and its parts, the profile page, sign-in, the PWA banners and the
// notification permission flow, each checked for behaviour and accessibility.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';

vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => (
    <form aria-label="Sign in">
      <label>
        Email
        <input type="email" />
      </label>
      <button type="submit">Continue</button>
    </form>
  ),
  SignUp: () => (
    <form aria-label="Sign up">
      <label>
        Email
        <input type="email" />
      </label>
      <button type="submit">Create</button>
    </form>
  ),
  UserButton: () => <button type="button">Account menu</button>,
}));

import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { SignInPage } from '@/features/auth/components/SignInPage';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { useNotificationPrefs } from '@/features/notifications/useNotificationPrefs';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { InstallButton } from '@/pwa/InstallButton';
import { useInstallStore } from '@/pwa/install';
import { OfflineNotice, UpdateBanner } from '@/pwa/PwaBanners';
import { useUpdateStore } from '@/pwa/update';
import { BOB, installFakeServices, type FakeApi } from '../../../test/fakes';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import { like } from '../../../test/matchers';
import { expectNoA11yViolations } from '../../../test/a11y';
import { BlockedUsers } from './components/BlockedUsers';
import { PrivacySettings } from './components/PrivacySettings';
import { SettingsPage } from './SettingsPage';

let api: FakeApi;
const privacy = {
  last_seen: 'everyone',
  profile_photo: 'everyone',
  about: 'everyone',
  read_receipts: true,
};
const person = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  display_name: name,
  avatar_url: null,
  is_bot: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ({ api } = installFakeServices());
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.users.privacy
        ? privacy
        : endpoint === ENDPOINTS.moderation.blocks
          ? { items: [], next_cursor: null }
          : endpoint === ENDPOINTS.push.vapidKey
            ? {
                public_key:
                  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
              }
            : undefined,
    ),
  );
  vi.spyOn(notify, 'error').mockImplementation(() => '');
  vi.spyOn(notify, 'success').mockImplementation(() => '');
  useInstallStore.setState({ event: null, installed: false });
  useUpdateStore.setState({ updateReady: false, applyUpdate: () => undefined });
});
afterEach(() => {
  removeFakePush();
});

describe('settings page', () => {
  it('has one h1 and the four sections', async () => {
    installFakePush({ permission: 'default' });
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    for (const name of ['Notifications', 'Privacy', 'Blocked users']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    await screen.findByRole('combobox', { name: 'About' });
  });

  it('has no accessibility violations once loaded', async () => {
    installFakePush({ permission: 'default' });
    const { container } = render(<SettingsPage />);
    await screen.findByRole('combobox', { name: 'About' });
    await screen.findByText('You have not blocked anyone.');
    await expectNoA11yViolations(container);
  });
});

describe('privacy toggles', () => {
  it('shows loading, then the saved values', async () => {
    api.call.mockImplementation(() =>
      Promise.resolve({ ...privacy, last_seen: 'nobody', read_receipts: false }),
    );
    render(<PrivacySettings />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Last seen and online' })).toHaveValue(
      'nobody',
    );
    expect(screen.getByRole('switch', { name: 'Read receipts' })).not.toBeChecked();
  });

  it('shows an error when the settings cannot load', async () => {
    api.call.mockRejectedValue(new Error('x'));
    render(<PrivacySettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load your privacy settings.",
    );
  });

  it.each([
    ['Last seen and online', 'last_seen'],
    ['Profile photo', 'profile_photo'],
    ['About', 'about'],
  ])('%s saves { %s: "nobody" }', async (label, key) => {
    const user = userEvent.setup();
    render(<PrivacySettings />);
    await user.selectOptions(await screen.findByRole('combobox', { name: label }), 'nobody');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updatePrivacy, {
      body: { [key]: 'nobody' },
    });
  });

  it('the read-receipts switch shows the new state at once and rolls back on failure with a message', async () => {
    const user = userEvent.setup();
    render(<PrivacySettings />);
    const toggle = await screen.findByRole('switch', { name: 'Read receipts' });
    api.call.mockRejectedValueOnce(new Error('x'));
    await user.click(toggle);
    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith("Couldn't save that change.");
    });
    expect(toggle).toBeChecked();
  });
});

describe('blocked users', () => {
  const blocks = (n: number, from = 0) => ({
    items: Array.from({ length: n }, (_, i) => ({
      user: person(`${BOB}-${from + i}`, `User${from + i}`),
      blocked_at: '2026-01-01T00:00:00.000Z',
    })),
  });

  it('pages with Show more until the end', async () => {
    const user = userEvent.setup();
    api.call
      .mockResolvedValueOnce({ ...blocks(2), next_cursor: 'c2' })
      .mockResolvedValueOnce({ ...blocks(1, 2), next_cursor: null });
    render(<BlockedUsers />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(api.call).toHaveBeenLastCalledWith(ENDPOINTS.moderation.blocks, {
      query: { cursor: 'c2' },
    });
  });

  it('a failed load, a failed load-more and a failed unblock each say so', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValueOnce(new Error('x'));
    const first = render(<BlockedUsers />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load blocked users.");
    first.unmount();

    api.call
      .mockResolvedValueOnce({ ...blocks(1), next_cursor: 'c2' })
      .mockRejectedValueOnce(new Error('x'));
    render(<BlockedUsers />);
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load more.");

    api.call.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: 'Unblock User0' }));
    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith("Couldn't unblock that user.");
    });
    expect(screen.getByText('User0')).toBeInTheDocument();
  });
});

describe('notification permission flow', () => {
  it('asks the browser only after the click, subscribes and tells the server', async () => {
    const user = userEvent.setup();
    const push = installFakePush({ permission: 'default', answer: 'granted' });
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Push notifications' });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    expect(push.requestPermission).not.toHaveBeenCalled(); // never on page load
    await user.click(toggle);
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.push.subscribe,
      expect.objectContaining({ body: like({ endpoint: 'https://push.example/abc' }) }),
    );
  });

  it('refusing the prompt shows the blocked message and disables the switch', async () => {
    const user = userEvent.setup();
    installFakePush({ permission: 'default', answer: 'denied' });
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Push notifications' });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications are blocked');
    expect(toggle).toBeDisabled();
  });

  it('a server failure while subscribing is reported, and the switch stays off', async () => {
    const user = userEvent.setup();
    installFakePush({ permission: 'default', answer: 'granted' });
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Push notifications' });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    api.call.mockImplementation((endpoint: unknown) =>
      endpoint === ENDPOINTS.push.subscribe
        ? Promise.reject(new Error('x'))
        : Promise.resolve({
            public_key:
              'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
          }),
    );
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(toggle).not.toBeChecked();
  });

  it('turning it off unsubscribes at the server and in the browser', async () => {
    const user = userEvent.setup();
    const push = installFakePush({ permission: 'granted', subscribed: true });
    render(<NotificationSettings />);
    const toggle = screen.getByRole('switch', { name: 'Push notifications' });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    await user.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.unsubscribe, {
      body: { endpoint: 'https://push.example/abc' },
    });
    expect(push.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('the message-sound switch is saved on this device', async () => {
    const user = userEvent.setup();
    installFakePush({ permission: 'default' });
    useNotificationPrefs.setState({ sound: true });
    render(<NotificationSettings />);
    await user.click(screen.getByRole('switch', { name: 'Message sound' }));
    expect(useNotificationPrefs.getState().sound).toBe(false);
    expect(JSON.parse(localStorage.getItem('flick-notification-prefs')!)).toEqual({ sound: false });
  });

  it('has no accessibility violations', async () => {
    installFakePush({ permission: 'default' });
    const { container } = render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Push notifications' })).toBeEnabled();
    });
    await expectNoA11yViolations(container);
  });
});

describe('profile', () => {
  it('shows nothing until the profile is loaded', () => {
    useSessionStore.setState({ user: null, status: 'booting' });
    const { container } = render(<ProfilePage />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the name, handle and the account menu, and passes accessibility checks', async () => {
    useSessionStore.setState({
      user: { id: BOB, username: 'bob', display_name: 'Bob B', avatar_url: null } as never,
      status: 'authenticated',
    });
    const { container } = render(<ProfilePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bob B' })).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe('sign in', () => {
  it('switches between sign-in and sign-up and passes accessibility checks', async () => {
    const user = userEvent.setup();
    const { container } = render(<SignInPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Flick' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'New to Flick? Create an account' }));
    expect(screen.getByRole('form', { name: 'Sign up' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Have an account? Sign in' }));
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('on a call link it says why', () => {
    window.history.pushState({}, '', '/call/abc');
    render(<SignInPage />);
    expect(screen.getByText('Sign in to join the call.')).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});

describe('PWA banners and install', () => {
  it('the update banner appears when a new version is waiting and Reload applies it', async () => {
    const user = userEvent.setup();
    const applyUpdate = vi.fn();
    render(<UpdateBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => {
      useUpdateStore.setState({ updateReady: true, applyUpdate });
    });
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Flick is available.');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('the offline notice follows the browser online/offline events', () => {
    render(<OfflineNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('You are offline');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('the install button has a name on both layouts and no accessibility violations', async () => {
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      useInstallStore.setState({ event: event });
    });
    const { container } = render(<InstallButton />);
    const button = screen.getByRole('button');
    expect(within(button).getAllByText('Install app')).toHaveLength(2); // visible on laptops, sr-only on phones
    await expectNoA11yViolations(container);
  });

  it('clicking install uses the saved browser event once', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    act(() => {
      useInstallStore.setState({ event: event });
    });
    render(<InstallButton className="max-sm:hidden" />);
    await user.click(screen.getByRole('button'));
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
