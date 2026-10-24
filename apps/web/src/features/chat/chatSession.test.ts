import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONV,
  ME,
  type FakeApi,
  type FakeTransport,
  installFakeServices,
  makeConversation,
  makeMessage,
  ok,
} from '../../../test/fakes';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { startChatSession } from './chatSession';
import { useChatStore } from './useChatStore';

let transport: FakeTransport;
let api: FakeApi;
let stop: () => void;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const emptyPage = ok({ events: [], removed_conversation_ids: [], next_cursor: null });

beforeEach(async () => {
  ({ transport, api } = installFakeServices());
  api.call.mockResolvedValue({
    items: [makeConversation({ last_seq: 5 })],
    next_cursor: null,
  });
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  stop = startChatSession(ME);
  await flush();
});
afterEach(() => {
  stop();
});

describe('chat session', () => {
  it('syncs on connect and again on every reconnect', async () => {
    expect(transport.sentOf('sync_request')).toHaveLength(1);
    await transport.reply('sync_request', emptyPage);

    transport.setState('reconnecting');
    transport.setState('connected');
    expect(transport.sentOf('sync_request')).toHaveLength(2);
    expect(transport.sentOf('sync_request')[1]).toMatchObject({
      cursors: [{ conversation_id: CONV, after_seq: 5 }],
    });
  });

  it('applies a live message once, acks it, and drops a duplicate of the same seq', async () => {
    await transport.reply('sync_request', emptyPage);
    const message = makeMessage({ seq: 6 });
    transport.fire('new_message', { message });
    transport.fire('new_message', { message });

    // First what the device already had when it connected (seq 5), then the new message once.
    expect(transport.sentOf('delivery_ack')).toEqual([
      { acks: [{ conversation_id: CONV, seq: 5 }] },
      { acks: [{ conversation_id: CONV, seq: 6 }] },
    ]);
    expect(useChatStore.getState().conversations[CONV]?.last_seq).toBe(6);
  });

  it('resyncs that conversation when a live event skips a seq', async () => {
    await transport.reply('sync_request', emptyPage);
    transport.fire('new_message', { message: makeMessage({ seq: 9 }) }); // 6-8 missing
    expect(transport.sentOf('sync_request')[1]).toMatchObject({
      cursors: [{ conversation_id: CONV, after_seq: 5 }],
    });
  });
});
