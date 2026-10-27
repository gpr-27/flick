// Phone Back behaviour of the signed-in shell: an open chat is a page over the list.
import { act, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';

vi.mock('@clerk/clerk-react', () => ({
  ClerkLoading: () => null,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  SignIn: () => null,
  SignUp: () => null,
  UserButton: () => <button type="button">Account</button>,
  useUser: () => ({ isLoaded: true, user: null }),
  useAuth: () => ({ getToken: () => Promise.resolve('tok'), signOut: vi.fn() }),
}));

import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { resetBackStackForTests } from '@/lib/useBackClose';
import { ME, installFakeServices, makeConversation } from '../../test/fakes';
import { App } from './App';

const me = { id: ME, username: 'me', display_name: 'Me', avatar_url: null };
const conv = makeConversation({ last_seq: 0 });

const stubPhone = (): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 639px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

const pressBack = async (): Promise<void> => {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
  });
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  const { api } = installFakeServices();
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.users.me
        ? me
        : endpoint === ENDPOINTS.conversations.list
          ? { items: [conv], next_cursor: null }
          : endpoint === ENDPOINTS.users.privacy
            ? {
                last_seen: 'everyone',
                profile_photo: 'everyone',
                about: 'everyone',
                read_receipts: true,
              }
            : endpoint === ENDPOINTS.moderation.blocks || endpoint === ENDPOINTS.calls.log
              ? { items: [], next_cursor: null }
              : endpoint === ENDPOINTS.push.vapidKey
                ? { public_key: null }
                : undefined,
    ),
  );
  useSessionStore.getState().reset();
  useSessionStore.setState({ status: 'booting' });
  useChatStore.getState().reset();
  useCallStore.getState()._cleanup();
  stubPhone();
});
afterEach(() => {
  resetBackStackForTests();
  vi.unstubAllGlobals();
});

describe('phone Back button', () => {
  it('returns from an open chat to the chat list', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await screen.findByRole('navigation', { name: 'Account' });
    await waitFor(() => {
      expect(useChatStore.getState().conversations[conv.id]).toBeDefined();
    });
    const before = window.history.length;
    act(() => {
      useChatStore.getState().select(conv.id);
    });
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/');

    await pressBack();
    expect(useChatStore.getState().selectedId).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('closing the chat in the app takes its history step away again', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await screen.findByRole('navigation', { name: 'Account' });
    await waitFor(() => {
      expect(useChatStore.getState().conversations[conv.id]).toBeDefined();
    });
    const startIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    act(() => {
      useChatStore.getState().select(conv.id);
    });
    act(() => {
      useChatStore.getState().select(null);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    expect(idx).toBe(startIdx);
    expect((window.history.state as Record<string, unknown> | null)?.__flickBack).toBeUndefined();
  });
});
