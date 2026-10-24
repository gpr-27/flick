// Table-driven sync scenarios: gaps, duplicates, out-of-order arrival, reconnects and the
// delivery_ack rules of docs/architecture/delivery-guarantees.md (rules 5, 6 and 7).
import { LIMITS, type SyncEvent } from '@chat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTransport, newMessageEvent, nextId, ok } from '../../../../test/fakes';
import { eventSeq, mergeEvents } from './merge';
import { createSyncEngine, type SyncEngine, type SyncSink } from './syncEngine';

const A = nextId();
const B = nextId();

const ev = (conversation: string, seq: number): SyncEvent =>
  newMessageEvent(seq, { conversation_id: conversation });
const edit = (conversation: string, seq: number): SyncEvent => ({
  type: 'message_edited',
  payload: {
    conversation_id: conversation,
    seq,
    message_id: nextId(),
    content: { type: 'text', text: 'edited' },
    edited_at: '2026-01-01T00:00:00.000Z',
  },
});

describe('mergeEvents: table', () => {
  // [name, lastSeq, arriving seqs, applied seqs, lastSeq after, gap]
  const table: [string, number, number[], number[], number, boolean][] = [
    ['next event', 5, [6], [6], 6, false],
    ['a run', 5, [6, 7, 8], [6, 7, 8], 8, false],
    ['reversed run', 5, [8, 7, 6], [6, 7, 8], 8, false],
    ['shuffled run', 0, [3, 1, 2], [1, 2, 3], 3, false],
    ['already applied', 5, [3, 4, 5], [], 5, false],
    ['duplicates inside the batch', 5, [6, 6, 6, 7], [6, 7], 7, false],
    ['straddles last_seq', 5, [4, 5, 6, 7], [6, 7], 7, false],
    ['gap of one', 5, [7], [], 5, true],
    ['gap after a contiguous part', 5, [6, 7, 9, 10], [6, 7], 7, true],
    ['gap hides everything after it', 5, [8, 9, 10], [], 5, true],
    ['empty batch', 5, [], [], 5, false],
    ['first event of a new conversation', 0, [1], [1], 1, false],
    ['first event missing', 0, [2], [], 0, true],
    ['huge seq jump', 5, [1_000_000], [], 5, true],
  ];
  it.each(table)('%s', (_name, last, arriving, applied, after, gap) => {
    const result = mergeEvents(
      last,
      arriving.map((s) => ev(A, s)),
    );
    expect(result.apply.map(eventSeq)).toEqual(applied);
    expect(result.lastSeq).toBe(after);
    expect(result.gap).toBe(gap);
  });

  it('edits, deletes and reactions take a seq just like messages', () => {
    const result = mergeEvents(1, [edit(A, 3), ev(A, 2)]);
    expect(result.apply.map((e) => e.type)).toEqual(['new_message', 'message_edited']);
    expect(result.lastSeq).toBe(3);
  });

  it('is idempotent: merging the result again applies nothing', () => {
    const events = [ev(A, 2), ev(A, 3), ev(A, 4)];
    const first = mergeEvents(1, events);
    const again = mergeEvents(first.lastSeq, events);
    expect(again.apply).toEqual([]);
    expect(again.lastSeq).toBe(first.lastSeq);
  });
});

describe('sync engine: scenarios', () => {
  let transport: FakeTransport;
  let applied: [string, number][];
  let sink: SyncSink;
  let engine: SyncEngine;

  beforeEach(() => {
    transport = new FakeTransport();
    applied = [];
    sink = {
      apply: vi.fn((e: SyncEvent) => {
        applied.push([
          e.type === 'new_message' ? e.payload.message.conversation_id : e.payload.conversation_id,
          eventSeq(e),
        ]);
      }),
      remove: vi.fn(),
      unknownConversation: vi.fn(),
      synced: vi.fn(),
    };
    engine = createSyncEngine({ sink, request: (t, p) => transport.request(t, p), retryMs: 50 });
    engine.baseline(A, 10);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const page = (events: SyncEvent[], next: string | null = null, removed: string[] = []) =>
    ok({ events, removed_conversation_ids: removed, next_cursor: next });
  const answer = (...args: Parameters<typeof page>) =>
    transport.reply('sync_request', page(...args));
  const acks = () => transport.sentOf('delivery_ack').flatMap((a) => a.acks);

  describe('live events when idle', () => {
    // [name, arriving live seqs, applied, last_seq, a resync was started]
    const table: [string, number[], number[], number, boolean][] = [
      ['next', [11], [11], 11, false],
      ['in order', [11, 12, 13], [11, 12, 13], 13, false],
      ['duplicate of what we have', [10, 11, 11], [11], 11, false],
      ['old event', [3], [], 10, false],
      ['skips one', [12], [], 10, true],
      ['out of order: the later one waits for the resync', [12, 11], [], 10, true],
    ];
    it.each(table)('%s', (_name, seqs, expectApplied, last, resync) => {
      for (const s of seqs) engine.onLive(ev(A, s));
      expect(applied.map(([, s]) => s)).toEqual(expectApplied);
      expect(engine.lastSeq(A)).toBe(last);
      expect(transport.sentOf('sync_request').length > 0).toBe(resync);
    });
  });

  it('out of order: a late event heals through the sync page, applied once, in order', async () => {
    engine.onLive(ev(A, 12)); // gap: 11 missing
    expect(transport.sentOf('sync_request')[0]?.cursors).toEqual([
      { conversation_id: A, after_seq: 10 },
    ]);
    engine.onLive(ev(A, 11)); // arrives while syncing: buffered
    expect(applied).toEqual([]);
    await answer([ev(A, 11), ev(A, 12)]);
    expect(applied.map(([, s]) => s)).toEqual([11, 12]);
    expect(engine.syncing).toBe(false);
    expect(sink.synced).toHaveBeenCalledTimes(1);
  });

  it('a gap that the first page cannot close asks again, then gives up after a few rounds', async () => {
    engine.start([A]);
    // The server keeps returning a page with a hole: 11 is never delivered.
    for (let i = 0; i < 6; i++) {
      try {
        await answer([ev(A, 13)]);
      } catch {
        break;
      }
    }
    expect(transport.sentOf('sync_request').length).toBeLessThanOrEqual(5);
    expect(sink.synced).toHaveBeenCalledTimes(1); // it settles instead of looping forever
    expect(engine.syncing).toBe(false);
    expect(engine.lastSeq(A)).toBe(10);
  });

  it('reconnect: the abandoned round is dropped and the new one starts from the current last_seq', async () => {
    engine.start();
    await answer([ev(A, 11)], 'c1'); // page 1 applied
    expect(engine.lastSeq(A)).toBe(11);
    engine.stop(); // connection dropped before page 2 came back
    expect(engine.syncing).toBe(false);
    await answer([ev(A, 12)]); // late answer to the old round: ignored
    expect(applied.map(([, s]) => s)).toEqual([11]);

    engine.start(); // reconnected
    expect(transport.sentOf('sync_request').at(-1)?.cursors).toEqual([
      { conversation_id: A, after_seq: 11 },
    ]);
    await answer([ev(A, 12), ev(A, 13)]);
    expect(applied.map(([, s]) => s)).toEqual([11, 12, 13]);
  });

  it('events that arrived while the connection was down are not duplicated by the next sync', async () => {
    engine.start();
    engine.onLive(ev(A, 11)); // buffered during the round
    engine.stop(); // buffer discarded: the next sync returns it
    engine.start();
    await answer([ev(A, 11)]); // the answer to the abandoned round: ignored
    expect(applied).toEqual([]);
    await answer([ev(A, 11)]);
    expect(applied.map(([, s]) => s)).toEqual([11]);
  });

  it('a live event that sync also returned is applied once (buffer replay)', async () => {
    engine.start();
    engine.onLive(ev(A, 11));
    engine.onLive(ev(A, 12));
    await answer([ev(A, 11)]);
    expect(applied.map(([, s]) => s)).toEqual([11, 12]);
  });

  it('syncs several conversations in one request and keeps their sequences apart', async () => {
    engine.baseline(B, 0);
    engine.start();
    expect(transport.sentOf('sync_request')[0]?.cursors).toEqual([
      { conversation_id: A, after_seq: 10 },
      { conversation_id: B, after_seq: 0 },
    ]);
    await answer([ev(B, 1), ev(A, 11), ev(B, 2)]);
    expect(engine.lastSeq(A)).toBe(11);
    expect(engine.lastSeq(B)).toBe(2);
  });

  it('caps the cursors of one request', () => {
    for (let i = 0; i < LIMITS.MAX_SYNC_CURSORS + 20; i++) engine.baseline(`c${i}`, 0);
    engine.start();
    expect(transport.sentOf('sync_request')[0]?.cursors).toHaveLength(LIMITS.MAX_SYNC_CURSORS);
  });

  it('baseline does not move a conversation that is already tracked', () => {
    engine.baseline(A, 99);
    expect(engine.lastSeq(A)).toBe(10);
  });

  it('forget stops tracking, so a later event is reported as unknown', () => {
    engine.forget(A);
    engine.onLive(ev(A, 11));
    expect(sink.unknownConversation).toHaveBeenCalledWith(A);
    expect(applied).toEqual([]);
  });

  it('a sync request while a round runs is queued and runs after it', async () => {
    engine.start();
    engine.start([A]);
    expect(transport.sentOf('sync_request')).toHaveLength(1);
    await answer([ev(A, 11)]);
    expect(transport.sentOf('sync_request')).toHaveLength(2);
    await answer([]);
    expect(engine.syncing).toBe(false);
    expect(sink.synced).toHaveBeenCalledTimes(1);
  });

  describe('page failures', () => {
    it('a retryable failure asks the same page again after the delay', async () => {
      vi.useFakeTimers();
      engine.start();
      await transport.reply('sync_request', {
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'slow', retryable: true },
      });
      expect(transport.sentOf('sync_request')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60);
      expect(transport.sentOf('sync_request')).toHaveLength(2);
      expect(engine.syncing).toBe(true);
    });

    it.each([
      ['OFFLINE', true],
      ['FORBIDDEN', false],
    ])('%s stops the round (the reconnect starts it again)', async (code, retryable) => {
      engine.start();
      await transport.reply('sync_request', {
        ok: false,
        error: { code, message: 'x', retryable },
      });
      expect(engine.syncing).toBe(false);
      expect(sink.synced).not.toHaveBeenCalled();
    });

    it('a failure while offline is not retried by a timer', async () => {
      vi.useFakeTimers();
      transport.open = false;
      engine.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(engine.syncing).toBe(false);
    });
  });

  describe('delivery_ack rules', () => {
    it('acks the highest seq applied, after applying, once per conversation per batch', async () => {
      engine.start();
      transport.sent.length = 0;
      await answer([ev(A, 11), ev(A, 12), ev(A, 13)]);
      expect(acks()).toEqual([{ conversation_id: A, seq: 13 }]);
    });

    it('never acks a duplicate or an old event', () => {
      engine.start();
      transport.sent.length = 0;
      engine.stop();
      engine.onLive(ev(A, 10));
      engine.onLive(ev(A, 4));
      expect(acks()).toEqual([]);
    });

    it('does not ack a gap: only the contiguous part is acknowledged', () => {
      engine.onLive(ev(A, 11));
      engine.onLive(ev(A, 13)); // hole at 12
      expect(acks().map((a) => a.seq)).toEqual([11]);
      expect(engine.lastSeq(A)).toBe(11);
    });

    it('acks each live event as it is stored, in order', () => {
      engine.onLive(ev(A, 11));
      engine.onLive(ev(A, 12));
      expect(acks()).toEqual([
        { conversation_id: A, seq: 11 },
        { conversation_id: A, seq: 12 },
      ]);
    });

    it('splits a large ack into frames of at most MAX_ACKS_PER_FRAME', () => {
      const total = LIMITS.MAX_ACKS_PER_FRAME * 2 + 5;
      for (let i = 0; i < total; i++) engine.baseline(`bulk${i}`, 3);
      engine.acknowledge();
      const frames = transport.sentOf('delivery_ack');
      expect(frames.every((f) => f.acks.length <= LIMITS.MAX_ACKS_PER_FRAME)).toBe(true);
      expect(frames.flatMap((f) => f.acks)).toHaveLength(total + 1); // plus conversation A
    });

    it('does not ack a conversation with nothing stored (seq 0)', () => {
      engine.baseline(B, 0);
      engine.acknowledge([B]);
      expect(acks()).toEqual([]);
    });

    it('a repeated acknowledge sends nothing new; a failed one is retried', async () => {
      engine.acknowledge();
      engine.acknowledge();
      expect(acks()).toHaveLength(1);
      transport.sent.length = 0;
      const offline = createSyncEngine({ sink, request: (t, p) => transport.request(t, p) });
      offline.baseline(B, 4);
      transport.open = false;
      offline.acknowledge();
      await Promise.resolve();
      await Promise.resolve();
      transport.open = true;
      offline.acknowledge();
      expect(acks()).toEqual([{ conversation_id: B, seq: 4 }]);
    });

    it('does not ack events of a conversation it does not know', () => {
      engine.onLive(ev(B, 1));
      expect(acks()).toEqual([]);
    });

    it('our own accepted message advances last_seq without an ack (we sent it)', () => {
      engine.noteOwn(A, 11);
      expect(engine.lastSeq(A)).toBe(11);
      expect(acks()).toEqual([]);
      // ...and the server echo of the same seq is then a duplicate.
      engine.onLive(ev(A, 11));
      expect(applied).toEqual([]);
    });

    it('noteOwn ignores a seq that is not the next one (a gap must still sync)', () => {
      engine.noteOwn(A, 14);
      expect(engine.lastSeq(A)).toBe(10);
    });
  });

  it('reset forgets every conversation and any round in progress', async () => {
    engine.start();
    engine.reset();
    expect(engine.lastSeq(A)).toBeUndefined();
    expect(engine.syncing).toBe(false);
    await answer([ev(A, 11)]);
    expect(applied).toEqual([]);
  });

  it('removed conversations in a page are dropped from tracking', async () => {
    engine.baseline(B, 2);
    engine.start();
    await answer([], null, [B]);
    expect(sink.remove).toHaveBeenCalledWith([B]);
    expect(engine.lastSeq(B)).toBeUndefined();
  });
});
