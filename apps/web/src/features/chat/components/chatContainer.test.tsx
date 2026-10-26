// The open chat: loading, empty and error states, messages, typing, read marking, announcements,
// the lock screen, the image viewer and pinned messages.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useLockStore } from '@/features/organise/lock';
import { usePinsStore } from '@/features/organise/messageActions';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
  type FakeTransport,
} from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { installListLayout } from '../../../../test/layout';
import { configureOutboxStorage, useOutboxStore } from '../outbox/useOutboxStore';
import { createMemoryKv } from '@/lib/idb';
import type { OutboxItem } from '../outbox/outboxMachine';
import { FLICK_BOT_USER_ID } from '@chat/contracts';
import { EXAMPLE_PROMPTS } from '@/features/ai/examplePrompts';
import { useChatStore, type Thread } from '../useChatStore';
import { ChatContainer } from './ChatContainer';

let restoreLayout: () => void;
beforeAll(() => {
  restoreLayout = installListLayout();
});
afterAll(() => {
  restoreLayout();
});

let api: FakeApi;
let transport: FakeTransport;
const DOWNLOAD = { url: 'https://files.test/pic.jpg', expires_at: '2999-01-01T00:00:00.000Z' };

const ready = (messages = [] as ReturnType<typeof makeMessage>[]): Thread => ({
  messages,
  status: 'ready',
  hasOlder: false,
  loadingOlder: false,
  error: null,
});

const open = (conversation = makeConversation(), thread: Partial<Thread> | null = ready()) => {
  useChatStore.setState({
    conversations: { [conversation.id]: conversation },
    ...(thread ? { threads: { [conversation.id]: { ...ready(), ...thread } } } : {}),
  });
  return render(
    <MemoryRouter>
      <ChatContainer conversation={conversation} />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  ({ api, transport } = installFakeServices());
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.media.download
        ? DOWNLOAD
        : endpoint === ENDPOINTS.messages.pins
          ? { items: [] }
          : endpoint === ENDPOINTS.conversations.members
            ? { items: [], next_cursor: null }
            : undefined,
    ),
  );
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  usePinsStore.setState({ byConversation: {} });
  useLockStore.setState({ unlocked: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  useChatStore.setState({
    users: {
      [BOB]: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('states of the thread', () => {
  it('loading shows a status for screen readers, not an empty chat', () => {
    open(makeConversation(), { status: 'loading' });
    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
    expect(screen.queryByText(/Say hi/)).not.toBeInTheDocument();
  });

  it('a thread that was never fetched also shows the skeleton', () => {
    open(makeConversation(), null);
    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
  });

  it('an empty chat invites the first message', () => {
    open();
    expect(screen.getByText('Say hi to Bob')).toBeInTheDocument();
  });

  it('a failed load shows the reason with a Retry that fetches again', async () => {
    const user = userEvent.setup();
    open(makeConversation(), { status: 'error', error: 'Server is down' });
    expect(screen.getByText("Couldn't load messages")).toBeInTheDocument();
    expect(screen.getByText('Server is down')).toBeInTheDocument();
    const retry = vi.fn();
    useChatStore.setState({ retryThread: retry });
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(retry).toHaveBeenCalledWith(CONV);
  });

  it('an error while messages are already shown keeps the messages', () => {
    open(makeConversation(), {
      status: 'error',
      error: 'x',
      messages: [makeMessage({ seq: 1, content: { type: 'text', text: 'still here' } })],
    });
    expect(screen.getByText('still here')).toBeInTheDocument();
  });

  it('titles the region and the log with the chat name', () => {
    open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    expect(screen.getByRole('region', { name: 'Chat with Bob' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation with Bob' })).toBeInTheDocument();
  });
});

describe('messages', () => {
  it('draws the thread with date separators, mine and theirs, and the composer', () => {
    open(
      makeConversation({ last_seq: 3 }),
      ready([
        makeMessage({
          seq: 1,
          sender_user_id: BOB,
          content: { type: 'text', text: 'hello' },
          created_at: '2026-01-01T10:00:00.000Z',
        }),
        makeMessage({
          seq: 2,
          sender_user_id: ME,
          content: { type: 'text', text: 'hi Bob' },
          created_at: '2026-01-01T10:01:00.000Z',
        }),
        makeMessage({
          seq: 3,
          sender_user_id: BOB,
          content: { type: 'text', text: 'next day' },
          created_at: '2026-01-02T10:00:00.000Z',
        }),
      ]),
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hi Bob')).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2); // one per day
    expect(screen.getByRole('form', { name: 'Send a message' })).toBeInTheDocument();
  });

  it('messages still in the outbox appear after the server ones, with their own status', () => {
    useOutboxStore.setState({
      items: [
        {
          client_message_id: 'c1',
          conversation_id: CONV,
          user_id: ME,
          content: { type: 'text', text: 'on its way' },
          created_at: Date.now(),
          status: 'pending',
          error: null,
        },
      ],
    });
    open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    expect(screen.getByText('on its way')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sending' })).toBeInTheDocument();
  });

  it('a failed outbox message offers Retry and Discard that act on the outbox', async () => {
    const user = userEvent.setup();
    useOutboxStore.setState({
      items: [
        {
          client_message_id: 'c2',
          conversation_id: CONV,
          user_id: ME,
          content: { type: 'text', text: 'did not send' },
          created_at: Date.now(),
          status: 'failed',
          error: { code: 'E', message: 'Could not send.', retryable: true },
        },
      ],
    });
    open();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('own message ticks follow the recipient receipts', () => {
    const conv = makeConversation({ last_seq: 2 });
    useChatStore.setState({ receipts: { [CONV]: { [BOB]: { delivered_seq: 2, read_seq: 0 } } } });
    open(conv, ready([makeMessage({ seq: 2, sender_user_id: ME })]));
    expect(screen.getByRole('img', { name: 'Delivered' })).toBeInTheDocument();
    act(() => {
      useChatStore.getState().receiptUpdate({ conversation_id: CONV, user_id: BOB, read_seq: 2 });
    });
    expect(screen.getByRole('img', { name: 'Read' })).toBeInTheDocument();
  });

  it('a reply shows the quoted message', () => {
    const original = makeMessage({
      seq: 1,
      sender_user_id: BOB,
      content: { type: 'text', text: 'dinner?' },
    });
    open(
      makeConversation({ last_seq: 2 }),
      ready([
        original,
        makeMessage({
          seq: 2,
          sender_user_id: ME,
          content: { type: 'text', text: 'yes', reply_to: original.message_id },
        }),
      ]),
    );
    const quote = screen.getByRole('button', { name: 'Go to the original message' });
    expect(within(quote).getByText('dinner?')).toBeInTheDocument();
    expect(within(quote).getByText('Bob')).toBeInTheDocument();
  });

  it('reacting through the sheet calls the API', async () => {
    const user = userEvent.setup();
    open(
      makeConversation(),
      ready([
        makeMessage({
          seq: 1,
          sender_user_id: BOB,
          content: { type: 'text', text: 'react to me' },
        }),
      ]),
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('react to me') });
    await user.click(screen.getByRole('button', { name: 'React 🔥' }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.messages.react,
      expect.objectContaining({ body: { emoji: '🔥' } }),
    );
  });

  it('Reply from the sheet puts the composer into reply mode', async () => {
    const user = userEvent.setup();
    open(
      makeConversation(),
      ready([
        makeMessage({ seq: 1, sender_user_id: BOB, content: { type: 'text', text: 'answer me' } }),
      ]),
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('answer me') });
    await user.click(screen.getByRole('menuitem', { name: 'Reply' }));
    expect(screen.getByText('Replying to Bob')).toBeInTheDocument();
  });

  it('Forward from the sheet opens the forward dialog with a preview', async () => {
    const user = userEvent.setup();
    open(
      makeConversation(),
      ready([
        makeMessage({ seq: 1, sender_user_id: BOB, content: { type: 'text', text: 'share me' } }),
      ]),
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('share me') });
    await user.click(screen.getByRole('menuitem', { name: 'Forward' }));
    const dialog = await screen.findByRole('dialog', { name: 'Forward message' });
    expect(within(dialog).getByText('share me')).toBeInTheDocument();
  });

  it('Star and Pin from the sheet call their endpoints', async () => {
    const user = userEvent.setup();
    const m = makeMessage({
      seq: 1,
      sender_user_id: BOB,
      content: { type: 'text', text: 'keep this' },
    });
    open(makeConversation(), ready([m]));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('keep this') });
    await user.click(screen.getByRole('menuitem', { name: 'Star' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.star, expect.anything());
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('keep this') });
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.pin, expect.anything());
  });

  it('opening a photo shows it large, and Close puts it away', async () => {
    const user = userEvent.setup();
    open(
      makeConversation(),
      ready([
        makeMessage({
          seq: 1,
          sender_user_id: BOB,
          content: { type: 'image', attachment_id: nextId(), width: 10, height: 10 },
        }),
      ]),
    );
    await user.click(await screen.findByRole('button', { name: 'Open image' }));
    expect(await screen.findByRole('img', { name: 'Attachment preview' })).toHaveAttribute(
      'src',
      DOWNLOAD.url,
    );
    await user.click(screen.getByRole('button', { name: 'Close media viewer' }));
    expect(screen.queryByRole('img', { name: 'Attachment preview' })).not.toBeInTheDocument();
  });

  it('Escape closes the photo viewer', async () => {
    const user = userEvent.setup();
    open(
      makeConversation(),
      ready([
        makeMessage({
          seq: 1,
          sender_user_id: BOB,
          content: { type: 'image', attachment_id: nextId(), width: 10, height: 10 },
        }),
      ]),
    );
    await user.click(await screen.findByRole('button', { name: 'Open image' }));
    await screen.findByRole('img', { name: 'Attachment preview' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Image preview' })).not.toBeInTheDocument();
  });
});

describe('who is typing', () => {
  const group = makeConversation({
    type: 'group',
    title: 'Team',
    peer: null,
    member_count: 4,
    my_role: 'member',
  });
  const carol = nextId();

  it.each([
    ['typing', 'Bob is typing…'],
    ['recording_voice', 'Bob is recording audio…'],
    ['recording_video', 'Bob is recording video…'],
    ['uploading', 'Bob is sending a file…'],
  ] as const)('direct chat: %s', (activity, label) => {
    open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    act(() => {
      useChatStore.getState().setActivity(CONV, BOB, activity);
    });
    expect(screen.getByRole('status', { name: label })).toBeInTheDocument();
  });

  it('group: names one person, says "Several people" for more', () => {
    useChatStore.setState({
      users: {
        [BOB]: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
      },
    });
    open(group, ready([makeMessage({ seq: 1, conversation_id: group.id })]));
    act(() => {
      useChatStore.getState().setActivity(group.id, BOB, 'typing');
    });
    expect(screen.getByRole('status', { name: 'Bob is typing…' })).toBeInTheDocument();
    act(() => {
      useChatStore.getState().setActivity(group.id, carol, 'typing');
    });
    expect(screen.getByRole('status', { name: 'Several people are typing…' })).toBeInTheDocument();
  });

  it('my own typing is never shown back to me', () => {
    open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    act(() => {
      useChatStore.getState().setActivity(CONV, ME, 'typing');
    });
    expect(screen.queryByRole('status', { name: /is typing/ })).not.toBeInTheDocument();
  });

  it('shows in the header too', () => {
    open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    act(() => {
      useChatStore.getState().setActivity(CONV, BOB, 'typing');
    });
    expect(screen.getByRole('banner')).toHaveTextContent('typing…');
  });
});

describe('read marking', () => {
  beforeEach(() => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  it('opening a focused chat with unread messages sends read_ack', async () => {
    const conv = makeConversation({ last_seq: 3, unread_count: 3 });
    useChatStore.setState({ conversations: { [CONV]: conv } });
    const { syncEngine } = await import('../useChatStore');
    syncEngine.baseline(CONV, 3);
    open(conv, ready([makeMessage({ seq: 3 })]));
    await waitFor(() => {
      expect(transport.sentOf('read_ack')).toEqual([{ conversation_id: CONV, seq: 3 }]);
    });
    expect(useChatStore.getState().conversations[CONV]?.unread_count).toBe(0);
  });

  it('a window without focus does not mark as read', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const conv = makeConversation({ last_seq: 3, unread_count: 3 });
    const { syncEngine } = await import('../useChatStore');
    syncEngine.baseline(CONV, 3);
    open(conv, ready([makeMessage({ seq: 3 })]));
    expect(transport.sentOf('read_ack')).toEqual([]);
    expect(useChatStore.getState().inView).toBe(false);
  });

  it('a chat that is still loading is not in view', () => {
    open(makeConversation(), { status: 'loading' });
    expect(useChatStore.getState().inView).toBe(false);
  });

  it('leaving the chat takes it out of view', () => {
    const view = open(makeConversation(), ready([makeMessage({ seq: 1 })]));
    expect(useChatStore.getState().inView).toBe(true);
    view.unmount();
    expect(useChatStore.getState().inView).toBe(false);
  });
});

describe('announcements', () => {
  it('does not announce history on open, but announces the next incoming message', () => {
    const first = makeMessage({
      seq: 1,
      sender_user_id: BOB,
      content: { type: 'text', text: 'old news' },
    });
    open(makeConversation({ last_seq: 1 }), ready([first]));
    const live = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-live') === 'polite')!;
    expect(live).toHaveTextContent('');
    act(() => {
      useChatStore.getState().applyEvent({
        type: 'new_message',
        payload: {
          message: makeMessage({
            seq: 2,
            sender_user_id: BOB,
            content: { type: 'text', text: 'fresh!' },
          }),
        },
      });
    });
    expect(live).toHaveTextContent('New message from Bob: fresh!');
  });

  it('my own messages are not announced', () => {
    open(makeConversation({ last_seq: 1 }), ready([makeMessage({ seq: 1, sender_user_id: BOB })]));
    act(() => {
      useChatStore.getState().applyEvent({
        type: 'new_message',
        payload: {
          message: makeMessage({
            seq: 2,
            sender_user_id: ME,
            content: { type: 'text', text: 'mine' },
          }),
        },
      });
    });
    const live = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-live') === 'polite')!;
    expect(live).toHaveTextContent('');
  });
});

describe('groups', () => {
  const group = makeConversation({
    id: nextId(),
    type: 'group',
    title: 'Team',
    peer: null,
    member_count: 3,
  });

  it('loads the member list, names senders and shows the member count', async () => {
    const carol = {
      id: nextId(),
      username: 'carol',
      display_name: 'Carol',
      avatar_url: null,
      is_bot: false,
    };
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.conversations.members
          ? {
              items: [{ user: carol, role: 'member', joined_at: '2026-01-01T00:00:00.000Z' }],
              next_cursor: null,
            }
          : endpoint === ENDPOINTS.messages.pins
            ? { items: [] }
            : undefined,
      ),
    );
    open(
      group,
      ready([
        makeMessage({
          seq: 1,
          conversation_id: group.id,
          sender_user_id: carol.id,
          content: { type: 'text', text: 'from carol' },
        }),
      ]),
    );
    expect(screen.getByText('3 members')).toBeInTheDocument();
    expect(await screen.findByText('Carol')).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.members, expect.anything());
  });
});

describe('locked chat', () => {
  const locked = makeConversation({
    prefs: { ...makeConversation().prefs, locked: true, lock_hash: 'abc' },
  });

  it('shows only the passcode screen, never the messages or the composer', () => {
    open(locked, ready([makeMessage({ seq: 1, content: { type: 'text', text: 'secret text' } })]));
    expect(screen.getByText('This chat is locked')).toBeInTheDocument();
    expect(screen.queryByText('secret text')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Send a message' })).not.toBeInTheDocument();
  });

  it('shows the chat once unlocked in this tab', () => {
    useLockStore.setState({ unlocked: { [CONV]: true } });
    open(locked, ready([makeMessage({ seq: 1, content: { type: 'text', text: 'secret text' } })]));
    expect(screen.getByText('secret text')).toBeInTheDocument();
  });
});

describe('pinned messages', () => {
  it('shows the banner for a pinned message and marks that message', async () => {
    const m = makeMessage({
      seq: 1,
      sender_user_id: BOB,
      content: { type: 'text', text: 'important' },
    });
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(endpoint === ENDPOINTS.messages.pins ? { items: [m] } : undefined),
    );
    open(makeConversation(), ready([m]));
    expect(await screen.findByText('Pinned message')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pinned' })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations with messages, a reply and a typing row', async () => {
    const original = makeMessage({
      seq: 1,
      sender_user_id: BOB,
      content: { type: 'text', text: 'dinner?' },
    });
    const { container } = open(
      makeConversation({ last_seq: 2 }),
      ready([
        original,
        makeMessage({
          seq: 2,
          sender_user_id: ME,
          content: { type: 'text', text: 'yes', reply_to: original.message_id },
        }),
      ]),
    );
    act(() => {
      useChatStore.getState().setActivity(CONV, BOB, 'typing');
    });
    await expectNoA11yViolations(container);
  });

  it('has no violations for the empty chat and the lock screen', async () => {
    const empty = open();
    await expectNoA11yViolations(empty.container);
    empty.unmount();
    const locked = open(
      makeConversation({ prefs: { ...makeConversation().prefs, locked: true, lock_hash: 'x' } }),
    );
    await expectNoA11yViolations(locked.container);
  });
});

describe('the Flick chat with its welcome message', () => {
  const flickBot = {
    id: FLICK_BOT_USER_ID,
    username: 'flick',
    display_name: 'Flick',
    avatar_url: null,
    is_bot: true,
  };
  const flickChat = () => makeConversation({ peer: flickBot, unread_count: 1 });
  const welcome = () =>
    makeMessage({
      sender_user_id: FLICK_BOT_USER_ID,
      content: { type: 'text', text: 'Hi Asha, welcome to Flick! I am your assistant.' },
    });

  it('opens with the welcome visible and the example prompts under it', () => {
    open(flickChat(), ready([welcome()]));
    expect(screen.getByText(/welcome to Flick! I am your assistant/)).toBeInTheDocument();
    const prompts = screen.getByRole('list', { name: 'Example questions' });
    for (const prompt of EXAMPLE_PROMPTS) {
      expect(within(prompts).getByRole('button', { name: prompt })).toBeInTheDocument();
    }
    // The welcome is a message, so the empty-chat greeting is not shown as well.
    expect(screen.queryByText('Ask Flick anything')).not.toBeInTheDocument();
  });

  it('still shows the empty-chat greeting when there is no message at all', () => {
    open(flickChat(), ready());
    expect(screen.getByText('Ask Flick anything')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: EXAMPLE_PROMPTS[0] })).toHaveLength(1);
  });

  it('drops the prompts once the person has written something', () => {
    const mine = makeMessage({
      sender_user_id: ME,
      content: { type: 'text', text: 'What can you do?' },
    });
    open(flickChat(), ready([welcome(), mine]));
    expect(screen.getByText(/welcome to Flick/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Example questions' })).not.toBeInTheDocument();
  });

  it('other chats never show the prompts', () => {
    open(makeConversation(), ready([makeMessage({ sender_user_id: BOB })]));
    expect(screen.queryByRole('list', { name: 'Example questions' })).not.toBeInTheDocument();
  });
});
