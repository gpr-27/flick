import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import {
  CONV,
  type FakeTransport,
  ME,
  installFakeServices,
  makeConversation,
  nextId,
  ok,
} from '../../../../test/fakes';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useChatStore } from '../useChatStore';
import { configureOutboxStorage, sendMessage, useOutboxStore } from './useOutboxStore';
import type { OutboxItem } from './outboxMachine';

let transport: FakeTransport;
let kv: ReturnType<typeof createMemoryKv<OutboxItem>>;

beforeEach(() => {
  vi.useFakeTimers();
  ({ transport } = installFakeServices());
  kv = createMemoryKv<OutboxItem>();
  configureOutboxStorage(kv);
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});
afterEach(() => {
  vi.useRealTimers();
});

const sends = () => transport.sentOf('send_message');

describe('offline outbox', () => {
  it('keeps a message written offline (and stores it) until the connection is ready', async () => {
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    expect(sends()).toEqual([]);
    expect(useOutboxStore.getState().items).toMatchObject([
      { client_message_id: id, status: 'pending' },
    ]);
    expect(await kv.getAll()).toMatchObject([{ client_message_id: id }]);

    useOutboxStore.getState().setReady(true);
    expect(sends()).toEqual([
      expect.objectContaining({ client_message_id: id, conversation_id: CONV }),
    ]);
  });

  it('resends after a reconnect with the same client_message_id', () => {
    useOutboxStore.getState().setReady(true);
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    expect(sends()).toHaveLength(1);

    useOutboxStore.getState().setReady(false); // connection dropped before any answer
    useOutboxStore.getState().setReady(true); // reconnected and synced
    expect(sends().map((s) => s.client_message_id)).toEqual([id, id]);
  });

  it('does not write the same pending message twice while waiting for the answer', () => {
    useOutboxStore.getState().setReady(true);
    sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    useOutboxStore.getState().setReady(true);
    expect(sends()).toHaveLength(1);
  });

  it("survives a reload: hydrate restores only this user's messages", async () => {
    const id = sendMessage(ME, CONV, { type: 'text', text: 'draft' });
    await kv.put('other', {
      ...useOutboxStore.getState().items[0]!,
      client_message_id: 'other',
      user_id: nextId(),
    });
    useOutboxStore.setState({ items: [] });

    await useOutboxStore.getState().hydrate(ME);
    expect(useOutboxStore.getState().items.map((i) => i.client_message_id)).toEqual([id]);
  });
});

describe('send -> accepted / failed -> retry', () => {
  const accepted = (id: string, seq = 1) => ({
    client_message_id: id,
    message_id: nextId(),
    conversation_id: CONV,
    seq,
    created_at: '2026-01-01T12:00:00.000Z',
    duplicate: false,
  });

  it('turns the pending bubble into the server message when accepted', async () => {
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
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
    useOutboxStore.getState().setReady(true);
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });

    useOutboxStore.getState().handleAccepted(accepted(id, 1));

    expect(useOutboxStore.getState().items).toEqual([]);
    expect(await kv.getAll()).toEqual([]);
    const [message] = useChatStore.getState().threads[CONV]!.messages;
    expect(message).toMatchObject({ client_message_id: id, seq: 1, sender_user_id: ME });
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(1);
  });

  it('marks a retryable failure as failed, and Retry resends with the same id', () => {
    useOutboxStore.getState().setReady(true);
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    useOutboxStore.getState().handleFailed({
      client_message_id: id,
      error: { code: 'RATE_LIMITED', message: 'Slow down.', retryable: true },
    });
    expect(useOutboxStore.getState().items[0]).toMatchObject({ status: 'failed' });

    useOutboxStore.getState().retry(id);

    expect(sends().map((s) => s.client_message_id)).toEqual([id, id]);
    expect(useOutboxStore.getState().items).toHaveLength(1); // never a second bubble
  });

  it('turns an accepted ack into the server message', async () => {
    useOutboxStore.getState().setReady(true);
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    await transport.reply('send_message', ok(accepted(id)));
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('shows a retryable failure when the server does not answer in time', async () => {
    useOutboxStore.getState().setReady(true);
    sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    const error = { code: 'TIMEOUT', message: 'The server did not answer.', retryable: true };
    await transport.reply('send_message', { ok: false, error });
    expect(useOutboxStore.getState().items[0]).toMatchObject({
      status: 'failed',
      error: { retryable: true },
    });
  });

  it('a failed ack that is not retryable is a permanent failure', async () => {
    useOutboxStore.getState().setReady(true);
    sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    const error = { code: 'NOT_A_MEMBER', message: 'You left this chat.', retryable: false };
    await transport.reply('send_message', { ok: false, error });
    expect(useOutboxStore.getState().items[0]).toMatchObject({
      status: 'failed',
      error: { retryable: false },
    });
  });

  it('an offline answer leaves the message pending, to be sent again', async () => {
    useOutboxStore.getState().setReady(true);
    sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    const error = { code: 'OFFLINE', message: 'The connection dropped.', retryable: true };
    await transport.reply('send_message', { ok: false, error });
    expect(useOutboxStore.getState().items[0]).toMatchObject({ status: 'pending' });
  });

  it('sends a queue written offline one message at a time, in order, per chat', async () => {
    const first = sendMessage(ME, CONV, { type: 'text', text: 'one' });
    vi.advanceTimersByTime(5);
    const second = sendMessage(ME, CONV, { type: 'text', text: 'two' });
    vi.advanceTimersByTime(5);
    const third = sendMessage(ME, CONV, { type: 'text', text: 'three' });

    useOutboxStore.getState().setReady(true);
    // Only the oldest is on the wire; the others wait for its answer.
    expect(sends().map((s) => s.client_message_id)).toEqual([first]);
    await transport.reply('send_message', ok(accepted(first, 1)));
    expect(sends().map((s) => s.client_message_id)).toEqual([first, second]);
    await transport.reply('send_message', ok(accepted(second, 2)));
    expect(sends().map((s) => s.client_message_id)).toEqual([first, second, third]);
  });

  it('a duplicate answer to a retry is harmless', () => {
    useOutboxStore.getState().setReady(true);
    const id = sendMessage(ME, CONV, { type: 'text', text: 'hello' });
    useOutboxStore.getState().handleAccepted(accepted(id));
    expect(() => {
      useOutboxStore.getState().handleAccepted({ ...accepted(id), duplicate: true });
    }).not.toThrow();
    expect(useOutboxStore.getState().items).toEqual([]);
  });
});
