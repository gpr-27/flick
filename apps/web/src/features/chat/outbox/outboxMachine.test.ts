import { describe, expect, it } from 'vitest';
import { reduceOutbox, type OutboxEvent, type OutboxItem } from './outboxMachine';

const queued = (id = 'client_msg_1'): OutboxEvent => ({
  type: 'queued',
  item: {
    client_message_id: id,
    conversation_id: '0192f5a0-0000-7000-8000-000000000050',
    user_id: '0192f5a0-0000-7000-8000-000000000001',
    content: { type: 'text', text: 'hi' },
    created_at: 1,
  },
});
const run = (...events: OutboxEvent[]): OutboxItem[] =>
  events.reduce<OutboxItem[]>((items, event) => reduceOutbox(items, event), []);
const retryable = { code: 'TIMEOUT', message: 'no answer', retryable: true };

describe('outbox state machine', () => {
  it('queues a message as pending', () => {
    expect(run(queued())).toMatchObject([{ client_message_id: 'client_msg_1', status: 'pending' }]);
  });

  it('removes the message once the server accepted it', () => {
    expect(run(queued(), { type: 'accepted', client_message_id: 'client_msg_1' })).toEqual([]);
  });

  it('shows an honest failed state with the reason', () => {
    const [item] = run(queued(), {
      type: 'failed',
      client_message_id: 'client_msg_1',
      error: retryable,
    });
    expect(item).toMatchObject({ status: 'failed', error: retryable });
  });

  it('retry puts it back to pending with the SAME client_message_id', () => {
    const items = run(
      queued(),
      { type: 'failed', client_message_id: 'client_msg_1', error: retryable },
      { type: 'retry', client_message_id: 'client_msg_1' },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      client_message_id: 'client_msg_1',
      status: 'pending',
      error: null,
    });
  });

  it('does not retry a permanent failure (it would only fail again)', () => {
    const permanent = { code: 'NOT_A_MEMBER', message: 'no', retryable: false };
    const [item] = run(
      queued(),
      { type: 'failed', client_message_id: 'client_msg_1', error: permanent },
      { type: 'retry', client_message_id: 'client_msg_1' },
    );
    expect(item?.status).toBe('failed');
  });

  it('queueing the same id twice keeps one message', () => {
    expect(run(queued(), queued())).toHaveLength(1);
  });

  it('discard removes a failed message; unknown ids are ignored', () => {
    const items = run(
      queued(),
      { type: 'failed', client_message_id: 'client_msg_1', error: retryable },
      { type: 'discard', client_message_id: 'client_msg_1' },
      { type: 'accepted', client_message_id: 'nope' },
    );
    expect(items).toEqual([]);
  });
});
