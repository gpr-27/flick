// The app shell: sign-in, loading, a failed profile load, the signed-in layout and its routes.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';

const clerk = vi.hoisted(() => ({
  signedIn: false,
  loading: false,
  signOut: vi.fn(() => Promise.resolve()),
}));
vi.mock('@clerk/clerk-react', () => ({
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (clerk.loading ? children : null),
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    !clerk.loading && clerk.signedIn ? children : null,
  SignedOut: ({ children }: { children: React.ReactNode }) =>
    !clerk.loading && !clerk.signedIn ? children : null,
  SignIn: () => <div>clerk-sign-in</div>,
  SignUp: () => <div>clerk-sign-up</div>,
  UserButton: () => <button type="button">Account</button>,
  useUser: () => ({ isLoaded: true, user: null }),
  useAuth: () => ({ getToken: () => Promise.resolve('tok'), signOut: clerk.signOut }),
}));

import { FullScreenError, FullScreenLoader } from '@/components/app/FullScreenStates';
import { getSessionToken } from '@/features/auth/authBridge';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  ME,
  BOB,
  installFakeServices,
  makeConversation,
  type FakeApi,
  type FakeTransport,
} from '../../test/fakes';
import { expectNoA11yViolations } from '../../test/a11y';
import { App } from './App';

let api: FakeApi;
let transport: FakeTransport;
const me = { id: ME, username: 'me', display_name: 'Me', avatar_url: null };

const renderApp = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clerk.signedIn = false;
  clerk.loading = false;
  ({ api, transport } = installFakeServices());
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.users.me
        ? me
        : endpoint === ENDPOINTS.conversations.list
          ? { items: [makeConversation({ last_seq: 0 })], next_cursor: null }
          : endpoint === ENDPOINTS.users.privacy
            ? {
                last_seen: 'everyone',
                profile_photo: 'everyone',
                about: 'everyone',
                read_receipts: true,
              }
            : endpoint === ENDPOINTS.moderation.blocks
              ? { items: [], next_cursor: null }
              : endpoint === ENDPOINTS.push.vapidKey
                ? { public_key: null }
                : endpoint === ENDPOINTS.calls.log
                  ? { items: [], next_cursor: null }
                  : undefined,
    ),
  );
  useSessionStore.getState().reset();
  useSessionStore.setState({ status: 'booting' });
  useChatStore.getState().reset();
  useCallStore.getState()._cleanup();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('signed out', () => {
  it('shows the sign-in page and a floating theme toggle, never the chat', () => {
    renderApp();
    expect(screen.getByText('clerk-sign-in')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to (dark|light) mode/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalled(); // no profile request without a session
    expect(transport.connect).not.toHaveBeenCalled();
  });

  it('passes accessibility checks', async () => {
    const { container } = renderApp();
    await expectNoA11yViolations(container);
  });
});

describe('Clerk is still loading', () => {
  it('shows the full-screen loader', () => {
    clerk.loading = true;
    renderApp();
    expect(screen.getByRole('status', { name: 'Loading Flick' })).toBeInTheDocument();
    expect(screen.queryByText('clerk-sign-in')).not.toBeInTheDocument();
  });
});

describe('signed in', () => {
  beforeEach(() => {
    clerk.signedIn = true;
  });

  it('loads the profile, then connects the realtime socket', async () => {
    renderApp();
    expect(screen.getByRole('status', { name: 'Loading Flick' })).toBeInTheDocument();
    await screen.findByRole('navigation', { name: 'Account' });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.me);
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });

  it('shows the layout: skip link, navbar, the chat list and the welcome pane', async () => {
    renderApp();
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('link', { name: 'Flick home' })).toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to Flick' })).toBeInTheDocument();
    expect(document.getElementById('main')).toHaveAttribute('tabindex', '-1');
  });

  it('a failed profile load shows the reason with Retry that tries again', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValueOnce(new Error('offline'));
    renderApp();
    expect(await screen.findByText("Can't reach Flick")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    await screen.findByRole('navigation', { name: 'Account' });
    expect(api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.users.me)).toHaveLength(2);
  });

  it.each([
    ['/settings', 'Settings'],
    ['/calls', 'Calls'],
    ['/profile', 'Me'],
  ])('route %s shows its page', async (path, heading) => {
    renderApp(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('an unknown route goes home', async () => {
    renderApp('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Welcome to Flick' })).toBeInTheDocument();
  });

  it('a ringing call shows the incoming-call dialog on top of everything', async () => {
    renderApp();
    await screen.findByRole('navigation', { name: 'Account' });
    act(() => {
      useCallStore.setState({
        callStatus: 'ringing',
        callType: 'audio',
        otherUser: { id: BOB, display_name: 'Bob', avatar_url: null },
        callId: 'c',
      });
    });
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Bob');
  });

  it('the connection banner tells the user when they are offline', async () => {
    renderApp();
    await screen.findByRole('navigation', { name: 'Account' });
    act(() => {
      transport.setState('offline');
    });
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    act(() => {
      transport.setState('connected');
    });
    await waitFor(() => {
      expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    });
  });

  it('signing in provides the token to plain modules through the bridge', async () => {
    renderApp();
    await waitFor(async () => {
      expect(await getSessionToken()).toBe('tok');
    });
  });

  it('leaving the app disconnects and forgets the user', async () => {
    const view = renderApp();
    await screen.findByRole('navigation', { name: 'Account' });
    view.unmount();
    expect(transport.disconnect).toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('the signed-in shell passes accessibility checks', async () => {
    const { container } = renderApp();
    await screen.findByRole('complementary', { name: 'Conversations' });
    await expectNoA11yViolations(container);
  });
});

describe('full-screen states', () => {
  it('loader is busy and named', () => {
    const { container } = render(<FullScreenLoader />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading Flick' })).toBeInTheDocument();
  });

  it('error shows title and message and calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { container } = render(
      <FullScreenError title="Oops" message="It broke" onRetry={onRetry} retrying={false} />,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Oops')).toBeInTheDocument();
    expect(screen.getByText('It broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it('while retrying the button is disabled', () => {
    render(<FullScreenError title="Oops" message="It broke" onRetry={vi.fn()} retrying />);
    expect(screen.getByRole('button', { name: /try again|retry|retrying/i })).toBeDisabled();
  });
});
