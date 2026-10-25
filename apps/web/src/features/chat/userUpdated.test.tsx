// A person you share a chat with renames themselves: the `user_updated` event reaches every place
// that shows their name, with no reload.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useDirectory } from '@/features/directory/useDirectory';
import { ENDPOINTS } from '@chat/contracts';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  type FakeApi,
  type FakeTransport,
} from '../../../test/fakes';
import { installListLayout } from '../../../test/layout';
import { createMemoryKv } from '@/lib/idb';
import { startChatSession } from './chatSession';
import { ChatContainer } from './components/ChatContainer';
import { conversationTitle } from './conversationView';
import type { OutboxItem } from './outbox/outboxMachine';
import { configureOutboxStorage, useOutboxStore } from './outbox/useOutboxStore';
import { useChatStore, type Thread } from './useChatStore';

let transport: FakeTransport;
let api: FakeApi;
let stop: () => void;
let restoreLayout: () => void;

beforeAll(() => {
  restoreLayout = installListLayout();
});
afterAll(() => {
  restoreLayout();
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const bobUser = { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false };
const renamed = {
  user_id: BOB,
  display_name: 'Robert Brown',
  username: 'robert',
  avatar_url: 'https://files.test/robert.jpg',
};
const group = makeConversation({ type: 'group', title: 'The gang', peer: null, member_count: 2 });
const ready = (messages: ReturnType<typeof makeMessage>[]): Thread => ({
  messages,
  status: 'ready',
  hasOlder: false,
  loadingOlder: false,
  error: null,
});

beforeEach(() => {
  localStorage.clear();
  ({ transport, api } = installFakeServices());
  api.call.mockResolvedValue({ items: [group], next_cursor: null });
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  useSessionStore.setState({
    user: { id: ME, username: 'me', display_name: 'Me', avatar_url: null } as never,
    status: 'authenticated',
  });
  stop = startChatSession(ME);
});
afterEach(() => {
  stop();
});

describe('user_updated', () => {
  it('updates the member list, the user cache and a direct chat title', () => {
    const direct = makeConversation({ id: 'direct-1' });
    useChatStore.setState({
      conversations: { [group.id]: group, [direct.id]: direct },
      members: {
        [group.id]: [
          { user: bobUser, role: 'member', joined_at: '2026-01-01T00:00:00.000Z' },
          {
            user: { ...bobUser, id: ME, display_name: 'Me' },
            role: 'admin',
            joined_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      users: { [BOB]: bobUser },
    });
    expect(conversationTitle(direct)).toBe('Bob');

    act(() => {
      transport.fire('user_updated', renamed);
    });

    const state = useChatStore.getState();
    expect(state.members[group.id]?.map((m) => m.user.display_name)).toEqual([
      'Robert Brown',
      'Me',
    ]);
    expect(state.members[group.id]?.[0]?.user.avatar_url).toBe(renamed.avatar_url);
    expect(state.users[BOB]).toMatchObject({ display_name: 'Robert Brown', username: 'robert' });
    expect(conversationTitle(state.conversations[direct.id]!)).toBe('Robert Brown');
    expect(state.profiles[BOB]).toEqual(renamed);
  });

  it('changes the sender name on message bubbles that are already on screen', async () => {
    const message = makeMessage({ sender_user_id: BOB, content: { type: 'text', text: 'hello' } });
    useChatStore.setState({
      conversations: { [group.id]: group },
      threads: { [CONV]: ready([message]) },
      members: {
        [group.id]: [{ user: bobUser, role: 'member', joined_at: '2026-01-01T00:00:00.000Z' }],
      },
      users: { [BOB]: bobUser },
    });
    render(
      <MemoryRouter>
        <ChatContainer conversation={group} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bob')).toBeInTheDocument();

    act(() => {
      transport.fire('user_updated', renamed);
    });

    expect(await screen.findByText('Robert Brown')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('follows a rename of my own made on another device', () => {
    act(() => {
      transport.fire('user_updated', {
        user_id: ME,
        display_name: 'New Me',
        username: 'newme',
        avatar_url: null,
      });
    });
    expect(useSessionStore.getState().user).toMatchObject({
      display_name: 'New Me',
      username: 'newme',
    });
  });

  it('updates people already loaded in the directory', async () => {
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.users.directory
          ? { items: [bobUser], next_cursor: null }
          : { items: [group], next_cursor: null },
      ),
    );
    const { result } = renderHook(() => useDirectory(''));
    await waitFor(() => {
      expect(result.current.items.map((u) => u.display_name)).toEqual(['Bob']);
    });
    act(() => {
      transport.fire('user_updated', renamed);
    });
    expect(result.current.items.map((u) => u.display_name)).toEqual(['Robert Brown']);
  });

  it('is forgotten on sign-out', async () => {
    act(() => {
      transport.fire('user_updated', renamed);
    });
    useChatStore.getState().reset();
    expect(useChatStore.getState().profiles).toEqual({});
    await flush();
  });
});
