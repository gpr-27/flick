// The sync coordinator (docs/messaging/protocol.md §8). It owns `last_seq` per conversation and
// decides what to do with every event; merge.ts holds the pure ordering/dedupe rules.
//
//   on every connect: start()  -> sync_request with last_seq of every conversation
//   live event:       while syncing, buffer it; otherwise merge + apply it
//   sync_request ack: merge + apply the page; if next_cursor, ask for the next page;
//                     at the end replay the buffer (merge drops what sync already delivered)
//   gap in seq:       sync just that conversation
//
// Why buffering is safe: the server puts the socket in its rooms BEFORE we sync, so live events
// flow while we sync. They may overlap with the pages, but never fall into a hole: seqs are
// dense, so whatever the pages and the buffer do not cover would show up as a gap.
import { LIMITS, type SyncEvent } from '@chat/contracts';
import type { RealtimeTransport, RequestData } from '@/lib/realtime';
import { logger } from '@/lib/logger';
import { groupByConversation, mergeEvents } from './merge';

type SyncPage = RequestData<'sync_request'>;

export interface SyncSink {
  /** Store one event (already in order, never a duplicate). */
  apply(event: SyncEvent): void;
  /** Conversations the user no longer belongs to. */
  remove(conversationIds: string[]): void;
  /** An event for a conversation we have no summary for: fetch it. The event is dropped. */
  unknownConversation(conversationId: string): void;
  /** A full sync round finished and the buffer was replayed. */
  synced(): void;
}

export interface SyncEngineDeps {
  sink: SyncSink;
  request: RealtimeTransport['request'];
  /** Wait this long before asking again after a page request failed (timeout, rate limit). */
  retryMs?: number;
}

export interface SyncEngine {
  readonly syncing: boolean;
  /** Set the starting point of a conversation we do not track yet (from REST). No-op if known. */
  baseline(conversationId: string, seq: number): void;
  lastSeq(conversationId: string): number | undefined;
  /**
   * Tell the server this device has everything up to last_seq of these conversations (all of them
   * when none are given), so the sender's tick can turn into "delivered". Safe to repeat: the
   * server only records a receipt when the cursor moves forward.
   */
  acknowledge(conversationIds?: readonly string[]): void;
  /** We hold our own message `seq` (message_accepted). Advances last_seq if it is the next one. */
  noteOwn(conversationId: string, seq: number): void;
  /** Sync all conversations (after connecting) or just the given ones (after a gap). */
  start(conversationIds?: readonly string[]): void;
  onLive(event: SyncEvent): void;
  forget(conversationId: string): void;
  /** Sign-out: forget everything. */
  reset(): void;
  /** The connection dropped: abandon the round in progress (start() runs again on reconnect). */
  stop(): void;
}

/** A conversation whose gap survives this many rounds in a row is not going to heal by asking. */
const MAX_ROUNDS = 4;

export function createSyncEngine({ sink, request, retryMs = 3_000 }: SyncEngineDeps): SyncEngine {
  const last = new Map<string, number>();
  // The highest seq per conversation we have told the server about, so the same receipt is not
  // sent twice. Recorded when sending and undone if the send fails, so the next connect retries.
  const acked = new Map<string, number>();
  let syncing = false;
  let buffer: SyncEvent[] = [];
  let cursors: { conversation_id: string; after_seq: number }[] = [];
  let queued: Set<string> | 'all' | null = null; // resync requests that arrived mid-round
  let rounds = 0;
  let round = 0; // answers to an older round are ignored
  let timer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  /** Merge events into their conversations. Returns the conversations that showed a gap. */
  function applyEvents(events: readonly SyncEvent[]): Set<string> {
    const gaps = new Set<string>();
    const acks: { conversation_id: string; seq: number }[] = [];
    for (const [conversationId, group] of groupByConversation(events)) {
      const known = last.get(conversationId);
      if (known === undefined) {
        sink.unknownConversation(conversationId);
        continue;
      }
      const merged = mergeEvents(known, group);
      for (const event of merged.apply) sink.apply(event);
      if (merged.lastSeq > known) {
        last.set(conversationId, merged.lastSeq);
        acks.push({ conversation_id: conversationId, seq: merged.lastSeq });
      }
      if (merged.gap) gaps.add(conversationId);
    }
    // "I have stored everything up to seq": sent only after the events above were applied.
    sendAcks(acks);
    return gaps;
  }

  function sendAcks(acks: { conversation_id: string; seq: number }[]): void {
    for (let i = 0; i < acks.length; i += LIMITS.MAX_ACKS_PER_FRAME) {
      const chunk = acks.slice(i, i + LIMITS.MAX_ACKS_PER_FRAME);
      for (const a of chunk)
        acked.set(a.conversation_id, Math.max(acked.get(a.conversation_id) ?? 0, a.seq));
      void request('delivery_ack', { acks: chunk }).then((result) => {
        if (result.ok) return;
        for (const a of chunk)
          if (acked.get(a.conversation_id) === a.seq) acked.delete(a.conversation_id);
      });
    }
  }

  function acknowledge(ids?: readonly string[]): void {
    sendAcks(
      [...new Set(ids ?? last.keys())].flatMap((id) => {
        const seq = last.get(id) ?? 0;
        return seq > (acked.get(id) ?? 0) ? [{ conversation_id: id, seq }] : [];
      }),
    );
  }

  function requestPage(cursor?: string): void {
    const thisRound = round;
    void request('sync_request', {
      cursors,
      limit: LIMITS.DEFAULT_SYNC_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    }).then((ack) => {
      if (thisRound !== round) return; // the connection dropped or a newer round began
      if (ack.ok) {
        onPage(ack.data);
      } else if (ack.error.code === 'OFFLINE' || !ack.error.retryable) {
        logger.warn('Sync stopped:', ack.error.code);
        stop(); // on a dropped socket, the reconnect calls start() again
      } else {
        logger.warn('Sync page failed; asking again:', ack.error.code);
        timer = setTimeout(() => {
          requestPage(cursor);
        }, retryMs);
      }
    });
  }

  /** Remember a resync request that arrived while a round is running. */
  function queue(ids: readonly string[] | null): void {
    if (ids === null || queued === 'all') queued = 'all';
    else queued = new Set([...(queued ?? []), ...ids]);
  }

  function begin(ids: readonly string[] | null): void {
    if (syncing) {
      queue(ids);
      return;
    }
    const targets = (ids ?? [...last.keys()]).filter((id) => last.has(id));
    syncing = true;
    round += 1;
    cursors = targets
      .slice(0, LIMITS.MAX_SYNC_CURSORS)
      .map((id) => ({ conversation_id: id, after_seq: last.get(id) ?? 0 }));
    requestPage();
  }

  function onPage(page: SyncPage): void {
    disarm();
    const gaps = applyEvents(page.events);
    if (gaps.size > 0) queue([...gaps]);
    if (page.removed_conversation_ids.length > 0) {
      for (const id of page.removed_conversation_ids) last.delete(id);
      sink.remove(page.removed_conversation_ids);
    }
    if (page.next_cursor) requestPage(page.next_cursor);
    else finishRound();
  }

  function finishRound(): void {
    syncing = false;
    disarm();
    const replay = buffer;
    buffer = [];
    const gaps = applyEvents(replay);
    const again = queued;
    queued = null;
    if (again === 'all' || again !== null || gaps.size > 0) {
      rounds += 1;
      if (rounds < MAX_ROUNDS) {
        begin(again === 'all' ? null : [...gaps, ...(again ?? [])]);
        return;
      }
      logger.warn('Sync gap did not close after several rounds', [...gaps]);
    }
    rounds = 0;
    sink.synced();
  }

  function stop(): void {
    syncing = false;
    round += 1;
    buffer = [];
    queued = null;
    rounds = 0;
    disarm();
  }

  return {
    get syncing() {
      return syncing;
    },
    baseline(conversationId, seq) {
      if (!last.has(conversationId)) last.set(conversationId, seq);
    },
    lastSeq: (conversationId) => last.get(conversationId),
    acknowledge,
    noteOwn(conversationId, seq) {
      if (last.get(conversationId) === seq - 1) last.set(conversationId, seq);
    },
    start(conversationIds) {
      rounds = 0;
      // On every connect: the chat list that loads when the app opens records each conversation's
      // last seq without going through applyEvents, so a message that arrived while the app was
      // closed would otherwise never be reported as delivered (the sender would stay on one tick
      // until the chat is opened, and then jump straight to "read").
      if (!conversationIds) acknowledge();
      begin(conversationIds ?? null);
    },
    onLive(event) {
      if (syncing) {
        buffer.push(event);
        return;
      }
      const gaps = applyEvents([event]);
      if (gaps.size > 0) begin([...gaps]);
    },
    forget: (conversationId) => {
      last.delete(conversationId);
      acked.delete(conversationId);
    },
    stop,
    reset() {
      stop();
      last.clear();
      acked.clear();
    },
  };
}
