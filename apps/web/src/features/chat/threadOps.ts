// Pure, immutable operations on one conversation's messages and its list summary.
// A thread is an array of MessageRecord sorted by seq; sync and live events go through here.
import type { ConversationSummary, MessageRecord, SyncEvent } from '@chat/contracts';

type Reactions = MessageRecord['reactions'];

/** Add or replace a message, keeping the list sorted by seq. */
export function insertMessage(
  messages: readonly MessageRecord[],
  record: MessageRecord,
): MessageRecord[] {
  const without = messages.filter((m) => m.message_id !== record.message_id);
  let at = without.length;
  while (at > 0 && (without[at - 1]?.seq ?? 0) > record.seq) at -= 1;
  return [...without.slice(0, at), record, ...without.slice(at)];
}

/**
 * Combine a fetched history page with what the thread already holds. Records we already hold win:
 * live events were applied to them, so they are at least as new as the fetched copy.
 */
export function mergeHistory(
  existing: readonly MessageRecord[],
  fetched: readonly MessageRecord[],
): MessageRecord[] {
  const held = new Set(existing.map((m) => m.message_id));
  return [...existing, ...fetched.filter((m) => !held.has(m.message_id))].sort(
    (a, b) => a.seq - b.seq,
  );
}

/** One reaction per user per message: a new emoji replaces the user's old one. */
export function withReaction(reactions: Reactions, userId: string, emoji: string): Reactions {
  const others = withoutReaction(reactions, userId);
  const group = others.find((r) => r.emoji === emoji);
  return group
    ? others.map((r) => (r === group ? { ...r, user_ids: [...r.user_ids, userId] } : r))
    : [...others, { emoji, user_ids: [userId] }];
}

/** Remove the user's reaction (all of it, or only `emoji` when given). */
export function withoutReaction(reactions: Reactions, userId: string, emoji?: string): Reactions {
  return reactions
    .map((r) =>
      emoji === undefined || r.emoji === emoji
        ? { ...r, user_ids: r.user_ids.filter((id) => id !== userId) }
        : r,
    )
    .filter((r) => r.user_ids.length > 0);
}

function update(
  messages: readonly MessageRecord[],
  messageId: string,
  change: (m: MessageRecord) => MessageRecord,
): MessageRecord[] {
  return messages.map((m) => (m.message_id === messageId ? change(m) : m));
}

/** Apply one sync/live event to a thread. Events for messages we do not hold are ignored. */
export function applyEventToThread(
  messages: readonly MessageRecord[],
  event: SyncEvent,
): MessageRecord[] {
  switch (event.type) {
    case 'new_message':
      return insertMessage(messages, event.payload.message);
    case 'message_edited': {
      const { message_id, content, edited_at } = event.payload;
      return update(messages, message_id, (m) => ({ ...m, content, edited_at }));
    }
    case 'message_deleted': {
      const { message_id, deleted_at } = event.payload;
      return update(messages, message_id, (m) => ({
        ...m,
        content: null,
        deleted_at,
        reactions: [],
      }));
    }
    case 'reaction_added': {
      const { message_id, user_id, emoji } = event.payload;
      return update(messages, message_id, (m) => ({
        ...m,
        reactions: withReaction(m.reactions, user_id, emoji),
      }));
    }
    case 'reaction_removed': {
      const { message_id, user_id, emoji } = event.payload;
      return update(messages, message_id, (m) => ({
        ...m,
        reactions: withoutReaction(m.reactions, user_id, emoji),
      }));
    }
  }
}

/**
 * Update the chat-list row for an event. A message from someone else counts as unread unless the
 * conversation is open and in view (then the read_ack is sent instead).
 */
export function applyEventToSummary(
  summary: ConversationSummary,
  event: SyncEvent,
  options: { myId: string; inView: boolean },
): ConversationSummary {
  const seq = event.type === 'new_message' ? event.payload.message.seq : event.payload.seq;
  let next: ConversationSummary = { ...summary, last_seq: Math.max(summary.last_seq, seq) };

  if (event.type === 'new_message') {
    const message = event.payload.message;
    next = { ...next, last_message: message };
    if (message.sender_user_id !== options.myId) {
      // In view: no unread badge, but read_seq stays where it was. markRead sends the read_ack
      // while read_seq is behind last_seq; moving it here would make markRead skip the ack.
      next = options.inView
        ? { ...next, unread_count: 0 }
        : { ...next, unread_count: next.unread_count + 1 };
    }
  } else if (next.last_message) {
    const [last] = applyEventToThread([next.last_message], event);
    if (last) next = { ...next, last_message: last };
  }
  return next;
}

/** Chat list order: pinned first, then the latest activity (what the server's keyset gives). */
export function sortConversations(list: readonly ConversationSummary[]): ConversationSummary[] {
  const time = (c: ConversationSummary): number =>
    Date.parse(c.last_message?.created_at ?? c.created_at);
  return [...list].sort(
    (a, b) => Number(b.prefs.pinned) - Number(a.prefs.pinned) || time(b) - time(a),
  );
}
