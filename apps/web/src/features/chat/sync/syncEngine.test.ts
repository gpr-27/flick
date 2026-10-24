import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncEvent } from '@chat/contracts';
import { CONV, FakeTransport, newMessageEvent, ok } from '../../../../test/fakes';
import { eventSeq } from './merge';
import { createSyncEngine, type SyncEngine, type SyncSink } from './syncEngine';

let transport: FakeTransport;
let applied: number[];
let sink: SyncSink;
let engine: SyncEngine;

beforeEach(() => {
  transport = new FakeTransport();
  applied = [];
  sink = {
    apply: vi.fn((e: SyncEvent) => void applied.push(eventSeq(e))),
    remove: vi.fn(),
    unknownConversation: vi.fn(),
    synced: vi.fn(),
  };
  engine = createSyncEngine({ sink, request: (t, p) => transport.request(t, p) });
  engine.baseline(CONV, 10);
});

const page = (events: SyncEvent[], next: string | null = null, removed: string[] = []) =>
  ok({ events, removed_conversation_ids: removed, next_cursor: next });
const answer = (...args: Parameters<typeof page>) => transport.reply('sync_request', page(...args));

describe('sync engine', () => {
  it('asks for everything after last_seq of every conversation', () => {
    engine.start();
    expect(transport.sentOf('sync_request')).toEqual([
      expect.objectContaining({ cursors: [{ conversation_id: CONV, after_seq: 10 }] }),
    ]);
    expect(engine.syncing).toBe(true);
  });

  it('buffers live events while syncing, then applies them in order without duplicates', async () => {
    engine.start();
    engine.onLive(newMessageEvent(13)); // arrives before the page that holds 11 and 12
    engine.onLive(newMessageEvent(12)); // also in the page: must not be applied twice
    expect(applied).toEqual([]);

    await answer([newMessageEvent(11), newMessageEvent(12)]);

    expect(applied).toEqual([11, 12, 13]);
    expect(engine.lastSeq(CONV)).toBe(13);
    expect(engine.syncing).toBe(false);
    expect(sink.synced).toHaveBeenCalledTimes(1);
  });

  it('follows next_cursor across pages before it is done', async () => {
    engine.start();
    await answer([newMessageEvent(11)], 'p2');
    expect(sink.synced).not.toHaveBeenCalled();
    const requests = transport.sentOf('sync_request');
    expect(requests[1]).toMatchObject({ cursor: 'p2' });

    await answer([newMessageEvent(12)]);
    expect(applied).toEqual([11, 12]);
    expect(sink.synced).toHaveBeenCalledTimes(1);
  });

  it('applies a live event directly when idle, and acks what it stored', () => {
    engine.onLive(newMessageEvent(11));
    expect(applied).toEqual([11]);
    expect(transport.sentOf('delivery_ack')).toEqual([
      { acks: [{ conversation_id: CONV, seq: 11 }] },
    ]);
  });

  it('syncs just that conversation when a live event skips a seq', async () => {
    engine.onLive(newMessageEvent(14)); // 11-13 missing
    expect(applied).toEqual([]);
    expect(transport.sentOf('sync_request')).toEqual([
      expect.objectContaining({ cursors: [{ conversation_id: CONV, after_seq: 10 }] }),
    ]);

    await answer([
      newMessageEvent(11),
      newMessageEvent(12),
      newMessageEvent(13),
      newMessageEvent(14),
    ]);
    expect(applied).toEqual([11, 12, 13, 14]);
  });

  it('does not ack before the events are applied, and never acks duplicates', () => {
    engine.onLive(newMessageEvent(10));
    expect(transport.sentOf('delivery_ack')).toEqual([]);
  });

  it('drops conversations the server says we left', async () => {
    engine.start();
    await answer([], null, [CONV]);
    expect(sink.remove).toHaveBeenCalledWith([CONV]);
    expect(engine.lastSeq(CONV)).toBeUndefined();
  });

  it('reports events of conversations it does not know instead of applying them', () => {
    engine.onLive(newMessageEvent(1, { conversation_id: '0192f5a0-0000-7000-8000-0000000000ff' }));
    expect(sink.unknownConversation).toHaveBeenCalledWith('0192f5a0-0000-7000-8000-0000000000ff');
    expect(applied).toEqual([]);
  });

  it('gives up cleanly when the socket is gone mid-sync', async () => {
    transport.open = false;
    engine.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.syncing).toBe(false);
  });

  it('ignores the answer of a round that was abandoned', async () => {
    engine.start();
    engine.stop(); // the connection dropped
    engine.start(); // and came back: a new round
    await answer([newMessageEvent(11)]); // the first, stale request
    expect(applied).toEqual([]);
    await answer([newMessageEvent(11)]);
    expect(applied).toEqual([11]);
  });
});
