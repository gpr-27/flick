import { describe, expect, it } from 'vitest';
import { BOB, CONV, ME, makeMessage, nextId } from '../../../test/fakes';
import type { OutboxItem } from './outbox/outboxMachine';
import { buildRows, rowStatus } from './threadRows';
import { applyEventToThread, insertMessage, mergeHistory, withReaction } from './threadOps';

const pendingItem = (overrides: Partial<OutboxItem> = {}): OutboxItem => ({
  client_message_id: 'client_msg_pending',
  conversation_id: CONV,
  user_id: ME,
  content: { type: 'text', text: 'typing…' },
  created_at: Date.parse('2026-01-02T00:00:00Z'),
  status: 'pending',
  error: null,
  ...overrides,
});

describe('thread rows', () => {
  it('shows pending messages after the server messages, and hides them once the server copy exists', () => {
    const server = makeMessage({ seq: 1, sender_user_id: ME });
    const rows = buildRows([server], [pendingItem()], CONV);
    expect(rows.map((r) => r.key)).toEqual([server.client_message_id, 'client_msg_pending']);

    const accepted = makeMessage({
      seq: 2,
      sender_user_id: ME,
      client_message_id: 'client_msg_pending',
    });
    const after = buildRows([server, accepted], [pendingItem()], CONV);
    expect(after).toHaveLength(2); // one bubble, with the same key as before
    expect(after[1]?.key).toBe('client_msg_pending');
  });

  it("derives ticks from the recipients' cursors (sent -> delivered -> read)", () => {
    const [row] = buildRows([makeMessage({ seq: 5, sender_user_id: ME })], [], CONV);
    const status = (delivered: number, read: number) =>
      rowStatus(row!, { [BOB]: { delivered_seq: delivered, read_seq: read } }, 1);
    expect(status(0, 0)).toBe('sent');
    expect(status(5, 0)).toBe('delivered');
    expect(status(5, 5)).toBe('read');
  });

  it('keeps a group message at one tick until EVERY member has it', () => {
    const [row] = buildRows([makeMessage({ seq: 5, sender_user_id: ME })], [], CONV);
    const one = { [BOB]: { delivered_seq: 5, read_seq: 5 } };
    expect(rowStatus(row!, one, 3)).toBe('sent'); // two other members, only one heard from
    expect(rowStatus(row!, { ...one, [nextId()]: { delivered_seq: 5, read_seq: 0 } }, 2)).toBe(
      'delivered',
    );
  });

  it('reports pending and failed from the outbox, not from the cursors', () => {
    const [row] = buildRows([], [pendingItem({ status: 'failed' })], CONV);
    expect(rowStatus(row!, undefined, 1)).toBe('failed');
  });
});

describe('thread operations', () => {
  it('keeps messages sorted by seq and replaces by message id', () => {
    const a = makeMessage({ seq: 1 });
    const c = makeMessage({ seq: 3 });
    const b = makeMessage({ seq: 2 });
    const list = insertMessage(insertMessage([a], c), b);
    expect(list.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(insertMessage(list, { ...b, starred: true })).toHaveLength(3);
  });

  it('history never overwrites a record that live events already updated', () => {
    const live = makeMessage({ seq: 4, edited_at: '2026-01-01T13:00:00.000Z' });
    const stale = { ...live, edited_at: null };
    const older = makeMessage({ seq: 3 });
    const merged = mergeHistory([live], [stale, older]);
    expect(merged.map((m) => m.seq)).toEqual([3, 4]);
    expect(merged[1]?.edited_at).not.toBeNull();
  });

  it('applies edits, deletes and one-reaction-per-user', () => {
    const m = makeMessage({ seq: 1 });
    let list = applyEventToThread([m], {
      type: 'message_edited',
      payload: {
        conversation_id: CONV,
        seq: 2,
        message_id: m.message_id,
        content: { type: 'text', text: 'edited' },
        edited_at: '2026-01-01T13:00:00.000Z',
      },
    });
    expect(list[0]?.content).toEqual({ type: 'text', text: 'edited' });

    expect(withReaction(withReaction([], ME, '👍'), ME, '❤️')).toEqual([
      { emoji: '❤️', user_ids: [ME] },
    ]);

    list = applyEventToThread(list, {
      type: 'message_deleted',
      payload: {
        conversation_id: CONV,
        seq: 3,
        message_id: m.message_id,
        deleted_by: ME,
        deleted_at: '2026-01-01T14:00:00.000Z',
      },
    });
    expect(list[0]).toMatchObject({ content: null, deleted_at: '2026-01-01T14:00:00.000Z' });
  });
});
