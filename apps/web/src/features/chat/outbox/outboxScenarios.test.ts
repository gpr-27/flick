// Outbox scenarios: the reducer as a table, then the store with a fake socket: offline queue,
// ordering after a reconnect, failures and retries, discard, duplicates and sign-out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { logger } from '@/lib/logger';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  nextId,
  ok,
  type FakeTransport,
} from '../../../../test/fakes';
import { useChatStore } from '../useChatStore';
import { reduceOutbox, type OutboxEvent, type OutboxItem } from './outboxMachine';
import { configureOutboxStorage, sendMessage, useOutboxStore } from './useOutboxStore';

const item = (id: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  client_message_id: id,
  conversation_id: CONV,
  user_id: ME,
  content: { type: 'text', text: id },
  created_at: 1,
  status: 'pending',
  error: null,
  ...over,
});
const err = (retryable: boolean) => ({ code: 'E', message: 'bad', retryable });

describe('outbox reducer: every state against every event', () => {
  const pending = item('m');
  const failedRetryable = item('m', { status: 'failed', error: err(true) });
  const failedPermanent = item('m', { status: 'failed', error: err(false) });
  const events: Record<string, OutboxEvent> = {
    accepted: { type: 'accepted', client_message_id: 'm' },
    failed: { type: 'failed', client_message_id: 'm', error: err(true) },
    retry: { type: 'retry', client_message_id: 'm' },
    discard: { type: 'discard', client_message_id: 'm' },
    queuedAgain: {
      type: 'queued',
      item: { ...pending, status: undefined, error: undefined } as never,
    },
  };
  // [state, event, resulting status or 'gone']
  const table: [string, OutboxItem | null, keyof typeof events, string][] = [
    ['pending', pending, 'accepted', 'gone'],
    ['pending', pending, 'failed', 'failed'],
    ['pending', pending, 'retry', 'pending'],
    ['pending', pending, 'discard', 'gone'],
    ['pending', pending, 'queuedAgain', 'pending'],
    ['failed (retryable)', failedRetryable, 'accepted', 'gone'],
    ['failed (retryable)', failedRetryable, 'failed', 'failed'],
    ['failed (retryable)', failedRetryable, 'retry', 'pending'],
    ['failed (retryable)', failedRetryable, 'discard', 'gone'],
    ['failed (permanent)', failedPermanent, 'retry', 'failed'],
    ['failed (permanent)', failedPermanent, 'discard', 'gone'],
    ['failed (permanent)', failedPermanent, 'accepted', 'gone'],
    ['nothing', null, 'accepted', 'gone'],
    ['nothing', null, 'failed', 'gone'],
    ['nothing', null, 'retry', 'gone'],
    ['nothing', null, 'discard', 'gone'],
  ];
  it.each(table)('%s + %s', (_state, start, event, expected) => {
    const result = reduceOutbox(start ? [start] : [], events[event]!);
    if (expected === 'gone') expect(result).toEqual([]);
    else expect(result.map((i) => i.status)).toEqual([expected]);
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('retry clears the error and keeps the same id and content', () => {
    const [retried] = reduceOutbox([failedRetryable], events.retry!);
    expect(retried).toMatchObject({ client_message_id: 'm', status: 'pending', error: null });
    expect(retried?.content).toEqual(failedRetryable.content);
  });

  it('only touches the targeted item and never mutates its input', () => {
    const other = item('other');
    const input = [pending, other];
    const frozen = JSON.stringify(input);
    const out = reduceOutbox(input, events.failed!);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(out.find((i) => i.client_message_id === 'other')).toBe(other);
  });
});

describe('outbox store scenarios', () => {
  let transport: FakeTransport;
  let kv: ReturnType<typeof createMemoryKv<OutboxItem>>;
  const store = () => useOutboxStore.getState();
  const sends = () => transport.sentOf('send_message');
  const accepted = (id: string, seq: number, duplicate = false) => ({
    client_message_id: id,
    message_id: nextId(),
    conversation_id: CONV,
    seq,
    created_at: '2026-01-01T12:00:00.000Z',
    duplicate,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
    ({ transport } = installFakeServices());
    kv = createMemoryKv<OutboxItem>();
    configureOutboxStorage(kv);
    useOutboxStore.setState({ items: [], ready: false });
    useChatStore.getState().reset();
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
    useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const write = (text: string): string => {
    vi.advanceTimersByTime(5);
    return sendMessage(ME, CONV, { type: 'text', text });
  };

  it('offline queue keeps order and sends oldest first on reconnect', () => {
    const ids = ['one', 'two', 'three', 'four'].map(write);
    expect(sends()).toEqual([]);
    store().setReady(true);
    expect(sends().map((s) => s.client_message_id)).toEqual(ids);
  });

  it('a message written while ready goes out at once, behind nothing', () => {
    store().setReady(true);
    const id = write('now');
    expect(sends().map((s) => s.client_message_id)).toEqual([id]);
  });

  it('after a drop, unanswered messages are resent in the same order with the same ids', () => {
    store().setReady(true);
    const ids = ['a', 'b', 'c'].map(write);
    transport.setState('reconnecting');
    store().setReady(false);
    transport.setState('connected');
    store().setReady(true);
    const all = sends().map((s) => s.client_message_id);
    expect(all).toEqual([...ids, ...ids]);
  });

  it('a message accepted before the drop is not resent', () => {
    store().setReady(true);
    const [a, b] = ['a', 'b'].map(write) as [string, string];
    store().handleAccepted(accepted(a, 1));
    store().setReady(false);
    store().setReady(true);
    expect(sends().map((s) => s.client_message_id)).toEqual([a, b, b]);
  });

  it('a failed message is not resent by a reconnect, only by Retry', () => {
    store().setReady(true);
    const id = write('x');
    store().handleFailed({ client_message_id: id, error: err(true) });
    store().setReady(false);
    store().setReady(true);
    expect(sends()).toHaveLength(1);
    store().retry(id);
    expect(sends().map((s) => s.client_message_id)).toEqual([id, id]);
  });

  it('Retry on a permanent failure sends nothing', () => {
    store().setReady(true);
    const id = write('x');
    store().handleFailed({ client_message_id: id, error: err(false) });
    store().retry(id);
    expect(sends()).toHaveLength(1);
    expect(store().items[0]?.status).toBe('failed');
  });

  it('Retry on a message that is already pending does not send it twice', () => {
    store().setReady(true);
    const id = write('x');
    store().retry(id);
    expect(sends().filter((s) => s.client_message_id === id)).toHaveLength(1);
  });

  it('discard removes it from the screen and from storage, and a late answer changes nothing', async () => {
    store().setReady(true);
    const id = write('regret');
    store().discard(id);
    expect(store().items).toEqual([]);
    expect(await kv.getAll()).toEqual([]);
    store().handleAccepted(accepted(id, 1));
    expect(useChatStore.getState().threads[CONV]).toBeUndefined();
  });

  it('a discarded in-flight message that then fails stays gone', async () => {
    store().setReady(true);
    const id = write('regret');
    store().discard(id);
    await transport.reply('send_message', { ok: false, error: err(true) });
    expect(store().items).toEqual([]);
    expect(id).toBeTruthy();
  });

  it('the same client_message_id queued twice is one message (idempotent)', () => {
    const id = write('once');
    const copy = store().items[0]!;
    useOutboxStore.setState({ items: reduceOutbox(store().items, { type: 'queued', item: copy }) });
    expect(store().items).toHaveLength(1);
    expect(id).toBe(copy.client_message_id);
  });

  it('two messages with the same text are two messages with two ids', () => {
    store().setReady(true);
    const a = write('same');
    const b = write('same');
    expect(a).not.toBe(b);
    expect(sends()).toHaveLength(2);
  });

  it('the server telling us a send was a duplicate still resolves the bubble', () => {
    store().setReady(true);
    const id = write('x');
    store().handleAccepted(accepted(id, 1, true));
    expect(store().items).toEqual([]);
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(1);
  });

  it('accepted answers arriving out of order each settle their own message', async () => {
    useChatStore.setState({
      threads: {
        [CONV]: {
          messages: [],
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
        },
      },
    });
    store().setReady(true);
    const [a, b] = ['a', 'b'].map(write) as [string, string];
    store().handleAccepted(accepted(b, 2));
    store().handleAccepted(accepted(a, 1));
    expect(useChatStore.getState().threads[CONV]!.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(await kv.getAll()).toEqual([]);
  });

  it('nothing is sent while the socket is not connected even if ready is stale', () => {
    store().setReady(true);
    transport.state = 'reconnecting';
    write('x');
    expect(sends()).toEqual([]);
    expect(store().items[0]?.status).toBe('pending');
  });

  it('a real ack through the fake socket removes the item', async () => {
    store().setReady(true);
    const id = write('x');
    await transport.reply('send_message', ok(accepted(id, 1)));
    expect(store().items).toEqual([]);
  });

  it('hydrate after a reload sends the surviving messages once ready', async () => {
    const id = write('survivor');
    useOutboxStore.setState({ items: [] });
    store().setReady(true);
    await store().hydrate(ME);
    expect(sends().map((s) => s.client_message_id)).toEqual([id]);
  });

  it("hydrate ignores another account's messages on a shared browser", async () => {
    await kv.put('theirs', item('theirs', { user_id: BOB }));
    await store().hydrate(ME);
    expect(store().items).toEqual([]);
  });

  it('hydrate survives a broken store', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    configureOutboxStorage({
      ...kv,
      getAll: () => Promise.reject(new Error('IDB blocked')),
    });
    await expect(store().hydrate(ME)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('a storage failure while queueing does not lose the on-screen message', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    configureOutboxStorage({ ...kv, put: () => Promise.reject(new Error('quota')) });
    const id = write('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(store().items.map((i) => i.client_message_id)).toEqual([id]);
    expect(warn).toHaveBeenCalled();
  });

  it('clear (sign-out) empties memory and storage and stops sending', async () => {
    store().setReady(true);
    write('a');
    await store().clear();
    expect(store().items).toEqual([]);
    expect(store().ready).toBe(false);
    expect(await kv.getAll()).toEqual([]);
    write('b'); // queued again but not sent: not ready
    expect(sends()).toHaveLength(1);
  });
});
