import { like } from '../../../test/matchers';
// The chat store as a state machine: events (edit, delete, reactions), receipts, typing and
// presence timers, mark-read, optimistic actions with rollback, list loading and groups.
import { ENDPOINTS, TYPING } from '@chat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { ApiError } from '@/lib/api';
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
} from '../../../test/fakes';
import { syncEngine, userName, useChatStore } from './useChatStore';

let api: FakeApi;
let transport: FakeTransport;
const store = () => useChatStore.getState();
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const seedThread = (messages = [makeMessage({ seq: 1 }), makeMessage({ seq: 2 })]) => {
  const conv = makeConversation({ last_seq: messages.length });
  useChatStore.setState({
    conversations: { [conv.id]: conv },
    threads: {
      [CONV]: { messages, status: 'ready', hasOlder: false, loadingOlder: false, error: null },
    },
  });
  syncEngine.baseline(CONV, messages.length);
  return messages;
};
const thread = () => store().threads[CONV]!.messages;

beforeEach(() => {
  ({ api, transport } = installFakeServices());
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  vi.spyOn(notify, 'error').mockImplementation(() => '');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('events: edit, delete, reactions, new message', () => {
  const ids = () => seedThread().map((m) => m.message_id);

  it('edit replaces the content and stamps edited_at', () => {
    const [first] = ids();
    store().applyEvent({
      type: 'message_edited',
      payload: {
        conversation_id: CONV,
        seq: 3,
        message_id: first!,
        content: { type: 'text', text: 'fixed' },
        edited_at: '2026-01-02T00:00:00.000Z',
      },
    });
    expect(thread()[0]).toMatchObject({
      content: { text: 'fixed' },
      edited_at: '2026-01-02T00:00:00.000Z',
    });
    expect(store().conversations[CONV]?.last_seq).toBe(3);
  });

  it('delete empties the content, clears reactions and keeps the row', () => {
    const [first] = seedThread([
      makeMessage({ seq: 1, reactions: [{ emoji: '👍', user_ids: [BOB] }] }),
    ]);
    store().applyEvent({
      type: 'message_deleted',
      payload: {
        conversation_id: CONV,
        seq: 2,
        message_id: first!.message_id,
        deleted_by: BOB,
        deleted_at: '2026-01-02T00:00:00.000Z',
      },
    });
    expect(thread()).toHaveLength(1);
    expect(thread()[0]).toMatchObject({
      content: null,
      deleted_at: '2026-01-02T00:00:00.000Z',
      reactions: [],
    });
  });

  it('deleting the last message updates the chat-list preview too', () => {
    const [only] = seedThread([makeMessage({ seq: 1 })]);
    useChatStore.setState((s) => ({
      conversations: {
        ...s.conversations,
        [CONV]: { ...s.conversations[CONV]!, last_message: only! },
      },
    }));
    store().applyEvent({
      type: 'message_deleted',
      payload: {
        conversation_id: CONV,
        seq: 2,
        message_id: only!.message_id,
        deleted_by: BOB,
        deleted_at: '2026-01-02T00:00:00.000Z',
      },
    });
    expect(store().conversations[CONV]?.last_message?.content).toBeNull();
  });

  // [name, events (applied in order), expected reactions on the target]
  const reactionTable: [string, ('add' | 'remove')[][], { emoji: string; user_ids: string[] }[]][] =
    [
      ['add', [['add']], [{ emoji: '👍', user_ids: [BOB] }]],
      ['add then remove', [['add', 'remove']], []],
      ['remove when absent', [['remove']], []],
    ];
  it.each(reactionTable)('reaction: %s', (_name, [steps], expected) => {
    const [target] = seedThread([makeMessage({ seq: 1 })]);
    let seq = 2;
    for (const step of steps!) {
      const type = step === 'add' ? 'reaction_added' : 'reaction_removed';
      store().applyEvent({
        type,
        payload: {
          conversation_id: CONV,
          seq: seq++,
          message_id: target!.message_id,
          user_id: BOB,
          emoji: '👍',
        },
      });
    }
    expect(thread()[0]?.reactions).toEqual(expected);
  });

  it('a second emoji from the same user replaces the first', () => {
    const [target] = seedThread([makeMessage({ seq: 1 })]);
    const react = (seq: number, emoji: string) =>
      store().applyEvent({
        type: 'reaction_added',
        payload: {
          conversation_id: CONV,
          seq,
          message_id: target!.message_id,
          user_id: BOB,
          emoji,
        },
      });
    react(2, '👍');
    react(3, '❤️');
    expect(thread()[0]?.reactions).toEqual([{ emoji: '❤️', user_ids: [BOB] }]);
  });

  it('two users reacting with one emoji share one chip', () => {
    const [target] = seedThread([makeMessage({ seq: 1 })]);
    for (const [seq, user] of [
      [2, BOB],
      [3, ME],
    ] as const) {
      store().applyEvent({
        type: 'reaction_added',
        payload: {
          conversation_id: CONV,
          seq,
          message_id: target!.message_id,
          user_id: user,
          emoji: '🔥',
        },
      });
    }
    expect(thread()[0]?.reactions).toEqual([{ emoji: '🔥', user_ids: [BOB, ME] }]);
  });

  it('events for a message we do not hold are ignored without error', () => {
    seedThread();
    expect(() => {
      store().applyEvent({
        type: 'message_edited',
        payload: {
          conversation_id: CONV,
          seq: 3,
          message_id: nextId(),
          content: { type: 'text', text: 'x' },
          edited_at: '2026-01-02T00:00:00.000Z',
        },
      });
    }).not.toThrow();
    expect(thread()).toHaveLength(2);
  });

  it('a new message from someone else: unread +1 off screen, 0 on screen', () => {
    seedThread();
    store().applyEvent({
      type: 'new_message',
      payload: { message: makeMessage({ seq: 3, sender_user_id: BOB }) },
    });
    expect(store().conversations[CONV]?.unread_count).toBe(1);

    useChatStore.setState({ selectedId: CONV, inView: true });
    store().applyEvent({
      type: 'new_message',
      payload: { message: makeMessage({ seq: 4, sender_user_id: BOB }) },
    });
    expect(store().conversations[CONV]?.unread_count).toBe(0);
  });

  it('my own message never adds unread', () => {
    seedThread();
    store().applyEvent({
      type: 'new_message',
      payload: { message: makeMessage({ seq: 3, sender_user_id: ME }) },
    });
    expect(store().conversations[CONV]?.unread_count).toBe(0);
  });

  it('a new message clears the sender typing indicator', () => {
    seedThread();
    store().setActivity(CONV, BOB, 'typing');
    store().applyEvent({
      type: 'new_message',
      payload: { message: makeMessage({ seq: 3, sender_user_id: BOB }) },
    });
    expect(store().typing[CONV]).toEqual({});
  });

  it('a message for a thread that is not open updates only the chat list', () => {
    const conv = makeConversation();
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    store().applyEvent({
      type: 'new_message',
      payload: { message: makeMessage({ seq: 1, sender_user_id: BOB }) },
    });
    expect(store().threads[CONV]).toBeUndefined();
    expect(store().conversations[CONV]).toMatchObject({ last_seq: 1, unread_count: 1 });
  });
});

describe('receipts', () => {
  const update = (user: string, p: { delivered_seq?: number; read_seq?: number }) =>
    store().receiptUpdate({ conversation_id: CONV, user_id: user, ...p });

  it('cursors only move forward', () => {
    update(BOB, { delivered_seq: 5 });
    update(BOB, { delivered_seq: 3 });
    update(BOB, { read_seq: 4 });
    update(BOB, { read_seq: 2 });
    expect(store().receipts[CONV]?.[BOB]).toEqual({ delivered_seq: 5, read_seq: 4 });
  });

  it('a delivered-only update keeps the read cursor, and the reverse', () => {
    update(BOB, { read_seq: 4 });
    update(BOB, { delivered_seq: 6 });
    expect(store().receipts[CONV]?.[BOB]).toEqual({ delivered_seq: 6, read_seq: 4 });
  });

  it('keeps members apart', () => {
    const carol = nextId();
    update(BOB, { delivered_seq: 2 });
    update(carol, { read_seq: 9 });
    expect(store().receipts[CONV]).toEqual({
      [BOB]: { delivered_seq: 2, read_seq: 0 },
      [carol]: { delivered_seq: 0, read_seq: 9 },
    });
  });

  it('my own read from another device clears unread when it reaches the end', () => {
    const conv = makeConversation({ last_seq: 5, read_seq: 1, unread_count: 4 });
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    update(ME, { read_seq: 3 });
    expect(store().conversations[CONV]).toMatchObject({ read_seq: 3, unread_count: 4 });
    update(ME, { read_seq: 5 });
    expect(store().conversations[CONV]).toMatchObject({ read_seq: 5, unread_count: 0 });
    update(ME, { read_seq: 2 }); // old news
    expect(store().conversations[CONV]?.read_seq).toBe(5);
    expect(store().receipts[CONV]).toBeUndefined(); // my own receipts are not ticks
  });
});

describe('typing and activity timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows the indicator and hides it after the TTL if the stop was lost', () => {
    store().setActivity(CONV, BOB, 'typing');
    expect(store().typing[CONV]).toEqual({ [BOB]: 'typing' });
    vi.advanceTimersByTime(TYPING.TTL_MS - 1);
    expect(store().typing[CONV]).toEqual({ [BOB]: 'typing' });
    vi.advanceTimersByTime(2);
    expect(store().typing[CONV]).toEqual({});
  });

  it('a repeated typing_start renews the timer', () => {
    store().setActivity(CONV, BOB, 'typing');
    vi.advanceTimersByTime(TYPING.TTL_MS - 1000);
    store().setActivity(CONV, BOB, 'typing');
    vi.advanceTimersByTime(TYPING.TTL_MS - 1000);
    expect(store().typing[CONV]).toEqual({ [BOB]: 'typing' });
    vi.advanceTimersByTime(1500);
    expect(store().typing[CONV]).toEqual({});
  });

  it.each(['recording_voice', 'recording_video', 'uploading'] as const)(
    '%s is an activity too',
    (a) => {
      store().setActivity(CONV, BOB, a);
      expect(store().typing[CONV]?.[BOB]).toBe(a);
      store().setActivity(CONV, BOB, null);
      expect(store().typing[CONV]).toEqual({});
    },
  );

  it('clearing something that was not set changes nothing (same state object)', () => {
    const before = store().typing;
    store().setActivity(CONV, BOB, null);
    expect(store().typing).toBe(before);
  });

  it('two people typing are independent', () => {
    const carol = nextId();
    store().setActivity(CONV, BOB, 'typing');
    vi.advanceTimersByTime(3000);
    store().setActivity(CONV, carol, 'recording_voice');
    vi.advanceTimersByTime(3500);
    expect(store().typing[CONV]).toEqual({ [carol]: 'recording_voice' });
  });

  it('clearTyping drops all indicators and their timers', () => {
    store().setActivity(CONV, BOB, 'typing');
    store().clearTyping();
    expect(store().typing).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('sending my own typing', () => {
    it('is throttled to one typing_start per THROTTLE_MS', () => {
      vi.setSystemTime(100_000);
      store().notifyTyping(CONV);
      store().notifyTyping(CONV);
      vi.setSystemTime(100_000 + TYPING.THROTTLE_MS - 1);
      store().notifyTyping(CONV);
      expect(transport.sentOf('typing_start')).toHaveLength(1);
      vi.setSystemTime(100_000 + TYPING.THROTTLE_MS);
      store().notifyTyping(CONV);
      expect(transport.sentOf('typing_start')).toHaveLength(2);
    });

    it('typing_stop is sent only if a start was sent', () => {
      store().notifyStopTyping('never-typed');
      expect(transport.sentOf('typing_stop')).toEqual([]);
      vi.setSystemTime(500_000);
      store().notifyTyping(CONV);
      store().notifyStopTyping(CONV);
      store().notifyStopTyping(CONV);
      expect(transport.sentOf('typing_stop')).toHaveLength(1);
    });

    it('offline: nothing is recorded as sent, so the next try goes out', () => {
      vi.setSystemTime(900_000);
      transport.open = false;
      store().notifyTyping(CONV);
      transport.open = true;
      store().notifyTyping(CONV);
      expect(transport.sentOf('typing_start')).toHaveLength(1);
    });
  });
});

describe('presence', () => {
  it('records online and last seen per user', () => {
    store().presenceUpdate(BOB, true, null);
    store().presenceUpdate(BOB, false, '2026-01-01T00:00:00.000Z');
    expect(store().presence[BOB]).toEqual({
      online: false,
      last_seen_at: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('mark read', () => {
  it('sends read_ack with the last seq and zeroes unread', () => {
    const conv = makeConversation({ last_seq: 7, unread_count: 3 });
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    syncEngine.baseline(CONV, 7);
    store().markRead(CONV);
    expect(transport.sentOf('read_ack')).toEqual([{ conversation_id: CONV, seq: 7 }]);
    expect(store().conversations[CONV]).toMatchObject({ read_seq: 7, unread_count: 0 });
  });

  it('does nothing when already read', () => {
    const conv = makeConversation({ last_seq: 7, read_seq: 7, unread_count: 0 });
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    syncEngine.baseline(CONV, 7);
    store().markRead(CONV);
    expect(transport.sentOf('read_ack')).toEqual([]);
  });

  it('does nothing while the socket is down, so the caller can try again later', () => {
    const conv = makeConversation({ last_seq: 7, unread_count: 3 });
    useChatStore.setState({ conversations: { [conv.id]: conv } });
    syncEngine.baseline(CONV, 7);
    transport.state = 'reconnecting';
    store().markRead(CONV);
    expect(store().conversations[CONV]?.unread_count).toBe(3);
    expect(transport.sentOf('read_ack')).toEqual([]);
  });

  it('ignores a conversation it does not track', () => {
    store().markRead(nextId());
    expect(transport.sent).toEqual([]);
  });
});

describe('optimistic actions', () => {
  it('react: shows at once, calls the API, and rolls back with a message on failure', async () => {
    const [m] = seedThread([makeMessage({ seq: 1 })]);
    api.call.mockRejectedValueOnce(
      new ApiError({ status: 500, code: 'X', message: 'nope', retryable: false }),
    );
    const pending = store().react(m!, '👍');
    expect(thread()[0]?.reactions).toEqual([{ emoji: '👍', user_ids: [ME] }]);
    await pending;
    expect(thread()[0]?.reactions).toEqual([]);
    expect(notify.error).toHaveBeenCalled();
  });

  it('react again with the same emoji removes it (unreact)', async () => {
    const [m] = seedThread([makeMessage({ seq: 1, reactions: [{ emoji: '👍', user_ids: [ME] }] })]);
    await store().react(m!, '👍');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.unreact, expect.anything());
    expect(thread()[0]?.reactions).toEqual([]);
  });

  it('react with a different emoji sends react, not unreact', async () => {
    const [m] = seedThread([makeMessage({ seq: 1, reactions: [{ emoji: '👍', user_ids: [ME] }] })]);
    await store().react(m!, '❤️');
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.messages.react,
      expect.objectContaining({ body: { emoji: '❤️' } }),
    );
    expect(thread()[0]?.reactions).toEqual([{ emoji: '❤️', user_ids: [ME] }]);
  });

  it('edit: text keeps its type, a caption edit changes the caption; clears the editing state', async () => {
    const text = makeMessage({ seq: 1, content: { type: 'text', text: 'old' } });
    const image = makeMessage({
      seq: 2,
      content: { type: 'image', attachment_id: nextId(), width: 1, height: 1 },
    });
    seedThread([text, image]);
    useChatStore.setState({ editing: text });
    await store().editMessage(text, 'new');
    expect(store().editing).toBeNull();
    expect(api.call).toHaveBeenLastCalledWith(
      ENDPOINTS.messages.edit,
      expect.objectContaining({ body: { content: { type: 'text', text: 'new' } } }),
    );
    await store().editMessage(image, 'a caption');
    expect(api.call).toHaveBeenLastCalledWith(
      ENDPOINTS.messages.edit,
      expect.objectContaining({ body: { content: like({ type: 'image', caption: 'a caption' }) } }),
    );
  });

  it('edit does not change the thread itself (the edited event does)', async () => {
    const [m] = seedThread([makeMessage({ seq: 1, content: { type: 'text', text: 'old' } })]);
    await store().editMessage(m!, 'new');
    expect(thread()[0]?.content).toMatchObject({ text: 'old' });
  });

  it('edit failure tells the user', async () => {
    const [m] = seedThread([makeMessage({ seq: 1 })]);
    api.call.mockRejectedValueOnce(new Error('boom'));
    await store().editMessage(m!, 'x');
    expect(notify.error).toHaveBeenCalledWith("Couldn't edit the message.");
  });

  it('delete for me removes the row locally; delete for everyone waits for the event', async () => {
    const [a, b] = seedThread([makeMessage({ seq: 1 }), makeMessage({ seq: 2 })]);
    await store().deleteMessage(a!, 'me');
    expect(api.call).toHaveBeenLastCalledWith(
      ENDPOINTS.messages.delete,
      expect.objectContaining({ query: { for: 'me' } }),
    );
    expect(thread().map((m) => m.message_id)).toEqual([b!.message_id]);
    await store().deleteMessage(b!, 'everyone');
    expect(api.call).toHaveBeenLastCalledWith(
      ENDPOINTS.messages.delete,
      expect.objectContaining({ query: { for: 'everyone' } }),
    );
    expect(thread()).toHaveLength(1);
  });

  it('delete failure keeps the message and tells the user', async () => {
    const [a] = seedThread([makeMessage({ seq: 1 })]);
    api.call.mockRejectedValueOnce(new Error('offline'));
    await store().deleteMessage(a!, 'me');
    expect(thread()).toHaveLength(1);
    expect(notify.error).toHaveBeenCalledWith("Couldn't delete the message.");
  });

  it('reply and edit are mutually exclusive, and selecting a chat clears both', () => {
    const m = makeMessage({ seq: 1 });
    store().setReplyingTo(m);
    store().setEditing(m);
    expect(store()).toMatchObject({ replyingTo: null, editing: m });
    store().setReplyingTo(m);
    expect(store()).toMatchObject({ replyingTo: m, editing: null });
    store().select(null);
    expect(store()).toMatchObject({ replyingTo: null, editing: null });
  });
});

describe('loading the list and history', () => {
  it('loads every page of both the normal and the archived list', async () => {
    const a = makeConversation({ id: nextId(), last_seq: 2 });
    const b = makeConversation({ id: nextId(), last_seq: 4 });
    const c = makeConversation({ id: nextId() });
    api.call
      .mockResolvedValueOnce({ items: [a], next_cursor: 'p2' })
      .mockResolvedValueOnce({ items: [b], next_cursor: null })
      .mockResolvedValueOnce({ items: [c], next_cursor: null });
    await store().loadConversations();
    expect(Object.keys(store().conversations).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(store().listStatus).toBe('ready');
    expect(syncEngine.lastSeq(b.id)).toBe(4);
    expect(api.call).toHaveBeenNthCalledWith(2, ENDPOINTS.conversations.list, {
      query: { filter: 'all', cursor: 'p2' },
    });
    expect(api.call).toHaveBeenNthCalledWith(3, ENDPOINTS.conversations.list, {
      query: { filter: 'archived' },
    });
    // The chat-list peer is remembered for names.
    expect(userName(store().users, BOB)).toBe('Bob');
    expect(userName(store().users, nextId())).toBe('Someone');
    expect(userName(store().users, null)).toBe('Someone');
  });

  it('a failed load shows an error state with a message', async () => {
    api.call.mockRejectedValue(new Error('down'));
    await store().loadConversations();
    expect(store()).toMatchObject({ listStatus: 'error', listError: "Couldn't load your chats." });
  });

  it('refresh adds new chats and takes server settings but keeps message-derived fields', async () => {
    const mine = makeConversation({ last_seq: 5, unread_count: 2, read_seq: 1 });
    useChatStore.setState({ conversations: { [mine.id]: mine } });
    const fresh = makeConversation({ id: nextId(), last_seq: 1 });
    api.call.mockResolvedValueOnce({
      items: [{ ...mine, title: 'Renamed', last_seq: 99, unread_count: 0 }, fresh],
      next_cursor: null,
    });
    await store().refreshConversations();
    expect(store().conversations[mine.id]).toMatchObject({
      title: 'Renamed',
      last_seq: 5,
      unread_count: 2,
      read_seq: 1,
    });
    expect(store().conversations[fresh.id]).toBeDefined();
  });

  it('a failed refresh leaves everything as it was', async () => {
    const mine = makeConversation();
    useChatStore.setState({ conversations: { [mine.id]: mine } });
    api.call.mockRejectedValueOnce(new Error('x'));
    await store().refreshConversations();
    expect(store().conversations[mine.id]).toBe(mine);
  });

  it('select creates a loading thread and fetches history once', async () => {
    api.call.mockResolvedValue({
      items: [makeMessage({ seq: 2 }), makeMessage({ seq: 1 })],
      next_cursor: 'older',
    });
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
    store().select(CONV);
    expect(store().threads[CONV]?.status).toBe('loading');
    await flush();
    expect(store().threads[CONV]).toMatchObject({ status: 'ready', hasOlder: true });
    expect(thread().map((m) => m.seq)).toEqual([1, 2]);
    store().select(null);
    store().select(CONV);
    expect(api.call).toHaveBeenCalledTimes(1);
  });

  it('a failed history load shows an error and retryThread loads again', async () => {
    api.call.mockRejectedValueOnce(new Error('x'));
    store().select(CONV);
    await flush();
    expect(store().threads[CONV]).toMatchObject({
      status: 'error',
      error: "Couldn't load messages.",
    });
    api.call.mockResolvedValueOnce({ items: [makeMessage({ seq: 1 })], next_cursor: null });
    store().retryThread(CONV);
    expect(store().threads[CONV]?.status).toBe('loading');
    await flush();
    expect(store().threads[CONV]).toMatchObject({ status: 'ready', error: null, hasOlder: false });
  });

  it('loadOlder pages before the oldest seq, merges and never duplicates', async () => {
    seedThread([makeMessage({ seq: 5 }), makeMessage({ seq: 6 })]);
    useChatStore.setState((s) => ({
      threads: { [CONV]: { ...s.threads[CONV]!, hasOlder: true } },
    }));
    const older = [makeMessage({ seq: 4 }), makeMessage({ seq: 3 }), thread()[0]!];
    api.call.mockResolvedValueOnce({ items: older, next_cursor: null });
    await store().loadOlder(CONV);
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.messages.history,
      expect.objectContaining({ query: { limit: 50, before_seq: 5 } }),
    );
    expect(thread().map((m) => m.seq)).toEqual([3, 4, 5, 6]);
    expect(store().threads[CONV]).toMatchObject({ hasOlder: false, loadingOlder: false });
  });

  it('loadOlder does nothing when there is nothing older or one is already loading', async () => {
    seedThread([makeMessage({ seq: 5 })]);
    await store().loadOlder(CONV);
    expect(api.call).not.toHaveBeenCalled();
    useChatStore.setState((s) => ({
      threads: { [CONV]: { ...s.threads[CONV]!, hasOlder: true, loadingOlder: true } },
    }));
    await store().loadOlder(CONV);
    expect(api.call).not.toHaveBeenCalled();
  });

  it('loadOlder failure clears the spinner and tells the user', async () => {
    seedThread([makeMessage({ seq: 5 })]);
    useChatStore.setState((s) => ({
      threads: { [CONV]: { ...s.threads[CONV]!, hasOlder: true } },
    }));
    api.call.mockRejectedValueOnce(new Error('x'));
    await store().loadOlder(CONV);
    expect(store().threads[CONV]?.loadingOlder).toBe(false);
    expect(notify.error).toHaveBeenCalledWith("Couldn't load earlier messages.");
  });

  it('setInView only changes state when it differs', () => {
    store().setInView(true);
    const before = store();
    store().setInView(true);
    expect(store()).toBe(before);
  });
});

describe('conversations and groups', () => {
  it('conversationUpdated with null removes the chat and clears the selection', () => {
    seedThread();
    useChatStore.setState({ selectedId: CONV });
    store().conversationUpdated(CONV, null);
    expect(store().conversations[CONV]).toBeUndefined();
    expect(store().threads[CONV]).toBeUndefined();
    expect(store().selectedId).toBeNull();
    expect(syncEngine.lastSeq(CONV)).toBeUndefined();
  });

  it('conversationUpdated for an unknown chat adds it', () => {
    const fresh = makeConversation({ id: nextId(), last_seq: 3 });
    store().conversationUpdated(fresh.id, fresh);
    expect(store().conversations[fresh.id]).toBe(fresh);
    expect(syncEngine.lastSeq(fresh.id)).toBe(3);
  });

  it('removeConversations keeps the selection when another chat is removed', () => {
    seedThread();
    useChatStore.setState({ selectedId: CONV });
    store().removeConversations([nextId()]);
    expect(store().selectedId).toBe(CONV);
  });

  it('openDirect adds the chat once and selects it', async () => {
    const conv = makeConversation({ id: nextId() });
    api.call.mockResolvedValue(conv);
    await store().openDirect(BOB);
    await store().openDirect(BOB);
    expect(store().selectedId).toBe(conv.id);
    expect(Object.keys(store().conversations)).toEqual([conv.id]);
  });

  it('openDirect failure tells the user', async () => {
    api.call.mockRejectedValue(new Error('x'));
    await store().openDirect(BOB);
    expect(notify.error).toHaveBeenCalledWith("Couldn't start the chat.");
    expect(store().selectedId).toBeNull();
  });

  it('createGroup returns whether it worked', async () => {
    const group = makeConversation({
      id: nextId(),
      type: 'group',
      title: 'Team',
      peer: null,
      member_count: 3,
    });
    api.call.mockResolvedValueOnce(group);
    expect(await store().createGroup('Team', [BOB])).toBe(true);
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.createGroup, {
      body: { title: 'Team', member_ids: [BOB] },
    });
    api.call.mockRejectedValueOnce(new Error('x'));
    expect(await store().createGroup('Again', [BOB])).toBe(false);
  });

  it('loadMembers follows pages and remembers the users', async () => {
    const m = (name: string, role: 'owner' | 'admin' | 'member') => ({
      user: { id: nextId(), username: name, display_name: name, avatar_url: null, is_bot: false },
      role,
      joined_at: '2026-01-01T00:00:00.000Z',
    });
    const [p1, p2] = [m('ann', 'owner'), m('ben', 'member')];
    api.call
      .mockResolvedValueOnce({ items: [p1], next_cursor: 'n' })
      .mockResolvedValueOnce({ items: [p2], next_cursor: null });
    await store().loadMembers(CONV);
    expect(store().members[CONV]?.map((x) => x.user.username)).toEqual(['ann', 'ben']);
    expect(userName(store().users, p2.user.id)).toBe('ben');
  });

  it.each([
    ['addMembers', () => store().addMembers(CONV, [BOB]), "Couldn't add members."],
    ['removeMember', () => store().removeMember(CONV, BOB), "Couldn't remove the member."],
    ['setRole', () => store().setRole(CONV, BOB, 'admin'), "Couldn't change the role."],
    ['renameGroup', () => store().renameGroup(CONV, 'New'), "Couldn't rename the group."],
    ['leave', () => store().leave(CONV), "Couldn't leave the group."],
  ])('%s failure tells the user and changes nothing', async (_name, run, message) => {
    seedThread();
    api.call.mockRejectedValue(new Error('x'));
    await run();
    expect(notify.error).toHaveBeenCalledWith(message);
    expect(store().conversations[CONV]).toBeDefined();
  });

  it('addMembers reports partial failures then reloads the members', async () => {
    api.call
      .mockResolvedValueOnce({
        added: [],
        failed: [
          { user_id: BOB, reason: 'privacy' },
          { user_id: nextId(), reason: 'full' },
        ],
      })
      .mockResolvedValueOnce({ items: [], next_cursor: null });
    await store().addMembers(CONV, [BOB]);
    expect(notify.error).toHaveBeenCalledWith('2 could not be added.');
    expect(store().members[CONV]).toEqual([]);
  });

  it('renameGroup applies the returned summary; leave removes the chat', async () => {
    seedThread();
    api.call.mockResolvedValueOnce(makeConversation({ title: 'Fresh' }));
    await store().renameGroup(CONV, 'Fresh');
    expect(store().conversations[CONV]?.title).toBe('Fresh');
    api.call.mockResolvedValueOnce(undefined);
    await store().leave(CONV);
    expect(store().conversations[CONV]).toBeUndefined();
  });

  it('reset returns everything to the signed-out state', () => {
    seedThread();
    store().setActivity(CONV, BOB, 'typing');
    store().presenceUpdate(BOB, true, null);
    store().reset();
    expect(store()).toMatchObject({
      conversations: {},
      threads: {},
      typing: {},
      presence: {},
      selectedId: null,
      listStatus: 'idle',
    });
    expect(syncEngine.lastSeq(CONV)).toBeUndefined();
  });
});
