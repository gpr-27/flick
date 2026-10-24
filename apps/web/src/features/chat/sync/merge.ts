// The merge step of the sync protocol (docs/messaging/protocol.md §8). Pure: no I/O, no clock.
//
// Every event that changes a conversation (new message, edit, delete, reaction) takes the next
// seq in that conversation, and seqs have no holes. So the client only has to track one number
// per conversation, `last_seq` ("everything up to here is applied, no gap"), and can decide
// from it alone whether an incoming event is old, next, or evidence of something missed:
//
//   seq <= last_seq      already applied (a live event that sync also returned): drop it
//   seq == last_seq + 1  the next event: apply it, last_seq moves up
//   seq >  last_seq + 1  a gap: something was missed, so stop and sync this conversation
import type { SyncEvent } from '@chat/contracts';

export const eventConversationId = (event: SyncEvent): string =>
  event.type === 'new_message'
    ? event.payload.message.conversation_id
    : event.payload.conversation_id;

export const eventSeq = (event: SyncEvent): number =>
  event.type === 'new_message' ? event.payload.message.seq : event.payload.seq;

export interface MergeResult {
  /** Events to apply now, in seq order, with no duplicates and no gaps. */
  apply: SyncEvent[];
  /** last_seq after applying `apply`. */
  lastSeq: number;
  /** True if an event beyond the next one was seen: the conversation needs a resync. */
  gap: boolean;
}

/**
 * Merge `incoming` events of ONE conversation into a conversation that is applied up to `lastSeq`.
 * Order and duplicates in `incoming` do not matter; the result is the same for any permutation
 * (live events and sync pages may interleave, and the buffer is replayed in arrival order).
 */
export function mergeEvents(lastSeq: number, incoming: readonly SyncEvent[]): MergeResult {
  const sorted = [...incoming].sort((a, b) => eventSeq(a) - eventSeq(b));
  const apply: SyncEvent[] = [];
  let next = lastSeq + 1;
  let gap = false;
  for (const event of sorted) {
    const seq = eventSeq(event);
    if (seq < next) continue; // already applied, or a duplicate of an event just queued
    if (seq > next) {
      gap = true;
      break; // events after the hole cannot be applied; they come back with the resync
    }
    apply.push(event);
    next += 1;
  }
  return { apply, lastSeq: next - 1, gap };
}

/** Split events by conversation, keeping arrival order inside each group. */
export function groupByConversation(events: readonly SyncEvent[]): Map<string, SyncEvent[]> {
  const groups = new Map<string, SyncEvent[]>();
  for (const event of events) {
    const id = eventConversationId(event);
    const group = groups.get(id);
    if (group) group.push(event);
    else groups.set(id, [event]);
  }
  return groups;
}
