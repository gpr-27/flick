// The chat session wiring: what happens, in order, after a connect, a drop and a reconnect, and
// how every realtime event reaches the stores (docs/architecture/delivery-guarantees.md rule 7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  ok,
  type FakeApi,
  type FakeTransport,
} from '../../../test/fakes';
import { bindSignOutReset, resetChatSession, startChatSession } from './chatSession';
import type { OutboxItem } from './outbox/outboxMachine';
import { configureOutboxStorage, sendMessage, useOutboxStore } from './outbox/useOutboxStore';
import { usePinsStore } from '../organise/messageActions';
import { useChatStore } from './useChatStore';

let transport: FakeTransport;
let api: FakeApi;
let stop: () => void;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const emptyPage = ok({ events: [], removed_conversation_ids: [], next_cursor: null });
const CAROL = nextId();

const start = async (conversations = [makeConversation({ last_seq: 5 })]) => {
  api.call.mockResolvedValue({ items: conversations, next_cursor: null });
  stop = startChatSession(ME);
  await flush();
};

beforeEach(() => {
  ({ transport, api } = installFakeServices());
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('order after connect', () => {
  it('loads the chat list, syncs, and only then lets the outbox send', async () => {
    useOutboxStore.getState().send(ME, CONV, { type: 'text', text: 'queued while offline' });
    await start();
    expect(transport.sentOf('sync_request')).toHaveLength(1);
    expect(transport.sentOf('send_message')).toEqual([]); // not before the catch-up
    expect(useOutboxStore.getState().ready).toBe(false);

    await transport.reply('sync_request', emptyPage);

    expect(useOutboxStore.getState().ready).toBe(true);
    expect(transport.sentOf('send_message')).toHaveLength(1);
    const order = transport.sent.map((e) => e.type);
    expect(order.indexOf('sync_request')).toBeLessThan(order.indexOf('send_message'));
  });

  it('does not sync before the chat list has loaded, and does once it has', async () => {
    let finish!: (v: unknown) => void;
    api.call.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    stop = startChatSession(ME);
    await flush();
    expect(transport.sentOf('sync_request')).toEqual([]);
    finish({ items: [makeConversation({ last_seq: 1 })], next_cursor: null });
    await flush();
    expect(transport.sentOf('sync_request')).toHaveLength(1);
  });

  it('does not sync while the socket is not connected yet', async () => {
    transport.state = 'connecting';
    await start();
    expect(transport.sentOf('sync_request')).toEqual([]);
    transport.setState('connected');
    expect(transport.sentOf('sync_request')).toHaveLength(1);
  });

  it('events that arrive during the sync are held and applied after it, in order, once', async () => {
    await start();
    transport.fire('new_message', { message: makeMessage({ seq: 7 }) });
    transport.fire('new_message', { message: makeMessage({ seq: 6 }) });
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(5); // held
    await transport.reply('sync_request', emptyPage);
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(7);
  });
});

describe('a drop and a reconnect', () => {
  it('stops the outbox, clears typing and abandons the sync round on a drop', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    useChatStore.getState().setActivity(CONV, BOB, 'typing');
    expect(useOutboxStore.getState().ready).toBe(true);

    transport.setState('reconnecting');

    expect(useOutboxStore.getState().ready).toBe(false);
    expect(useChatStore.getState().typing).toEqual({});
  });

  it('a message written during the outage is sent only after the next sync, once', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    transport.setState('reconnecting');
    const id = sendMessage(ME, CONV, { type: 'text', text: 'during the outage' });
    expect(transport.sentOf('send_message')).toEqual([]);

    transport.setState('connected');
    expect(transport.sentOf('send_message')).toEqual([]); // sync first
    await transport.reply('sync_request', emptyPage);
    expect(transport.sentOf('send_message').map((m) => m.client_message_id)).toEqual([id]);
  });

  it('what happened while away arrives through the sync, not the live feed', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    transport.setState('reconnecting');
    transport.setState('connected');
    const missed = makeMessage({ seq: 6, content: { type: 'text', text: 'while you were away' } });
    await transport.reply(
      'sync_request',
      ok({
        events: [{ type: 'new_message', payload: { message: missed } }],
        removed_conversation_ids: [],
        next_cursor: null,
      }),
    );
    expect(useChatStore.getState().conversations[CONV]?.last_message?.message_id).toBe(
      missed.message_id,
    );
    expect(useChatStore.getState().conversations[CONV]?.unread_count).toBe(1);
    expect(transport.sentOf('delivery_ack').at(-1)).toEqual({
      acks: [{ conversation_id: CONV, seq: 6 }],
    });
  });

  it('after the first sync, later syncs also refresh the chat list settings', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    const calls = api.call.mock.calls.length;
    transport.setState('reconnecting');
    transport.setState('connected');
    await transport.reply('sync_request', emptyPage);
    await flush();
    expect(api.call.mock.calls.length).toBeGreaterThan(calls);
  });

  it('a conversation removed while away is dropped', async () => {
    await start();
    await transport.reply(
      'sync_request',
      ok({ events: [], removed_conversation_ids: [CONV], next_cursor: null }),
    );
    expect(useChatStore.getState().conversations[CONV]).toBeUndefined();
  });
});

describe('every live event reaches the store', () => {
  beforeEach(async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
  });

  it('receipts, typing, activity, presence and conversation updates', () => {
    transport.fire('receipt_update', { conversation_id: CONV, user_id: BOB, delivered_seq: 5 });
    expect(useChatStore.getState().receipts[CONV]?.[BOB]).toEqual({
      delivered_seq: 5,
      read_seq: 0,
    });

    transport.fire('typing_start', { conversation_id: CONV, user_id: BOB });
    expect(useChatStore.getState().typing[CONV]).toEqual({ [BOB]: 'typing' });
    transport.fire('typing_stop', { conversation_id: CONV, user_id: BOB });
    expect(useChatStore.getState().typing[CONV]).toEqual({});

    transport.fire('activity', {
      conversation_id: CONV,
      user_id: BOB,
      activity: 'recording_voice',
      state: 'start',
    });
    expect(useChatStore.getState().typing[CONV]).toEqual({ [BOB]: 'recording_voice' });
    transport.fire('activity', {
      conversation_id: CONV,
      user_id: BOB,
      activity: 'recording_voice',
      state: 'stop',
    });
    expect(useChatStore.getState().typing[CONV]).toEqual({});

    transport.fire('presence_update', { user_id: BOB, online: true, last_seen_at: null });
    expect(useChatStore.getState().presence[BOB]).toEqual({ online: true, last_seen_at: null });

    transport.fire('conversation_updated', {
      conversation_id: CONV,
      conversation: makeConversation({ title: 'Renamed', last_seq: 5 }),
    });
    expect(useChatStore.getState().conversations[CONV]?.title).toBe('Renamed');
    transport.fire('conversation_updated', { conversation_id: CONV, conversation: null });
    expect(useChatStore.getState().conversations[CONV]).toBeUndefined();
  });

  it('a pins_changed event updates the pinned list', () => {
    const gone = makeMessage({ seq: 2 });
    usePinsStore.setState({ byConversation: { [CONV]: [gone] } });
    transport.fire('pins_changed', {
      conversation_id: CONV,
      message_id: gone.message_id,
      pinned: false,
      actor_user_id: BOB,
    });
    expect(usePinsStore.getState().byConversation[CONV]).toEqual([]);
  });

  it('edits, deletes and reactions arrive in seq order through the sync engine', () => {
    const m = makeMessage({ seq: 6, content: { type: 'text', text: 'v1' } });
    useChatStore.setState({
      threads: {
        [CONV]: {
          messages: [m],
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
        },
      },
    });
    transport.fire('message_edited', {
      conversation_id: CONV,
      seq: 6,
      message_id: m.message_id,
      content: { type: 'text', text: 'v2' },
      edited_at: '2026-01-02T00:00:00.000Z',
    });
    transport.fire('reaction_added', {
      conversation_id: CONV,
      seq: 7,
      message_id: m.message_id,
      user_id: BOB,
      emoji: '👍',
    });
    transport.fire('reaction_removed', {
      conversation_id: CONV,
      seq: 8,
      message_id: m.message_id,
      user_id: BOB,
      emoji: '👍',
    });
    transport.fire('message_deleted', {
      conversation_id: CONV,
      seq: 9,
      message_id: m.message_id,
      deleted_by: BOB,
      deleted_at: '2026-01-02T01:00:00.000Z',
    });
    const thread = useChatStore.getState().threads[CONV]!.messages[0]!;
    expect(thread.content).toBeNull();
    expect(thread.deleted_at).toBe('2026-01-02T01:00:00.000Z');
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(9);
  });

  it('a duplicate or reordered pair of live events changes nothing twice', () => {
    const e7 = makeMessage({ seq: 7 });
    transport.fire('new_message', { message: makeMessage({ seq: 6 }) });
    transport.fire('new_message', { message: e7 });
    transport.fire('new_message', { message: e7 });
    expect(useChatStore.getState().conversations[CONV]?.unread_count).toBe(2);
  });
});

describe('presence subscriptions', () => {
  it('subscribes to chat peers after the first sync and applies the answer', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    expect(transport.sentOf('presence_subscribe')).toEqual([{ user_ids: [BOB] }]);
    await transport.reply(
      'presence_subscribe',
      ok([{ user_id: BOB, online: true, last_seen_at: null }]),
    );
    expect(useChatStore.getState().presence[BOB]?.online).toBe(true);
  });

  it('does not ask again for the same people, but does when the list changes', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    await transport.reply('presence_subscribe', ok([]));
    useChatStore.setState((s) => ({ selectedId: CONV, conversations: { ...s.conversations } }));
    expect(transport.sentOf('presence_subscribe')).toHaveLength(1);

    const carolChat = makeConversation({
      id: nextId(),
      peer: {
        id: CAROL,
        username: 'carol',
        display_name: 'Carol',
        avatar_url: null,
        is_bot: false,
      },
    });
    useChatStore.setState((s) => ({
      conversations: { ...s.conversations, [carolChat.id]: carolChat },
    }));
    expect(transport.sentOf('presence_subscribe').at(-1)).toEqual({
      user_ids: [BOB, CAROL].sort(),
    });
  });

  it('a refused subscription is asked again on the next change', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    await transport.reply('presence_subscribe', {
      ok: false,
      error: { code: 'X', message: 'no', retryable: true },
    });
    useChatStore.setState((s) => ({ selectedId: CONV, conversations: { ...s.conversations } }));
    expect(transport.sentOf('presence_subscribe')).toHaveLength(2);
  });

  it('a new connection resubscribes', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    await transport.reply('presence_subscribe', ok([]));
    transport.setState('reconnecting');
    transport.setState('connected');
    await transport.reply('sync_request', emptyPage);
    expect(transport.sentOf('presence_subscribe')).toHaveLength(2);
  });

  it('an open group also watches its members, never myself, and at most 256', async () => {
    const group = makeConversation({
      id: nextId(),
      type: 'group',
      title: 'Team',
      peer: null,
      member_count: 300,
    });
    await start([group]);
    const members = Array.from({ length: 300 }, (_, i) => ({
      user: {
        id: `0192f5a0-0000-7000-8000-${String(i + 1000).padStart(12, '0')}`,
        username: `u${i}`,
        display_name: `U${i}`,
        avatar_url: null,
        is_bot: false,
      },
      role: 'member' as const,
      joined_at: '2026-01-01T00:00:00.000Z',
    }));
    members.push({
      user: { id: ME, username: 'me', display_name: 'Me', avatar_url: null, is_bot: false },
      role: 'member',
      joined_at: '2026-01-01T00:00:00.000Z',
    });
    useChatStore.setState({ selectedId: group.id, members: { [group.id]: members } });
    await transport.reply('sync_request', emptyPage);
    const ids = transport.sentOf('presence_subscribe').at(-1)!.user_ids;
    expect(ids).toHaveLength(256);
    expect(ids).not.toContain(ME);
  });
});

describe('ending the session', () => {
  it('stopping unsubscribes from events and stops the outbox', async () => {
    await start();
    await transport.reply('sync_request', emptyPage);
    stop();
    transport.fire('new_message', { message: makeMessage({ seq: 6 }) });
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(5);
    expect(useOutboxStore.getState().ready).toBe(false);
    stop = () => undefined;
  });

  it('resetChatSession forgets the chats and the unsent messages', async () => {
    await start();
    useOutboxStore.getState().send(ME, CONV, { type: 'text', text: 'x' });
    resetChatSession();
    await flush();
    expect(useChatStore.getState().conversations).toEqual({});
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('signing out (user goes from set to null) clears everything; signing in does not', async () => {
    bindSignOutReset();
    await start();
    useSessionStore.setState({ user: null, status: 'anonymous' });
    await flush();
    expect(useChatStore.getState().conversations).toEqual({});
    stop = () => undefined;
  });

  it('the outbox hydrates the stored messages of the signed-in user when the session starts', async () => {
    const kv = createMemoryKv<OutboxItem>();
    configureOutboxStorage(kv);
    await kv.put('c1', {
      client_message_id: 'c1',
      conversation_id: CONV,
      user_id: ME,
      content: { type: 'text', text: 'from last session' },
      created_at: 1,
      status: 'pending',
      error: null,
    });
    await kv.put('c2', {
      client_message_id: 'c2',
      conversation_id: CONV,
      user_id: BOB,
      content: { type: 'text', text: 'someone else' },
      created_at: 2,
      status: 'pending',
      error: null,
    });
    await start();
    expect(useOutboxStore.getState().items.map((i) => i.client_message_id)).toEqual(['c1']);
  });
});
