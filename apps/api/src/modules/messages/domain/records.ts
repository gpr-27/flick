import type { MessageRecord } from '@chat/contracts';
import type { MessageRow } from '@chat/db';
import type { Db } from '../../../db.js';
import { fromRow } from './content.js';

/**
 * Turns message rows into the contract's MessageRecord as seen by one viewer:
 *  - a message deleted for everyone has no content (a tombstone);
 *  - a view-once message the viewer already opened has no content;
 *  - the sender of a view-once message also learns whether anyone opened it (`viewed`);
 *  - reactions and the viewer's star are attached;
 *  - client_message_id is only shown to the sender (it is their idempotency key).
 * With `hiddenAsTombstone`, messages the viewer deleted "for me" and expired disappearing
 * messages come back as tombstones instead of being dropped. Sync needs that so seqs stay
 * continuous; history and search filter those rows out in SQL before they get here.
 */
export async function toRecords(
  db: Db,
  viewerId: string,
  rows: MessageRow[],
  options: { hiddenAsTombstone?: boolean } = {},
): Promise<MessageRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [reactionRows, starRows, openedRows, hiddenRows] = await Promise.all([
    db
      .selectFrom('reactions')
      .select(['message_id', 'user_id', 'emoji'])
      .where('message_id', 'in', ids)
      .orderBy('created_at')
      .execute(),
    db
      .selectFrom('starred_messages')
      .select('message_id')
      .where('user_id', '=', viewerId)
      .where('message_id', 'in', ids)
      .execute(),
    db
      .selectFrom('view_once_opens')
      .select('message_id')
      .where('user_id', '=', viewerId)
      .where('message_id', 'in', ids)
      .execute(),
    options.hiddenAsTombstone
      ? db
          .selectFrom('hidden_messages')
          .select(['message_id', 'hidden_at'])
          .where('user_id', '=', viewerId)
          .where('message_id', 'in', ids)
          .execute()
      : Promise.resolve([]),
  ]);

  const reactions = new Map<string, Map<string, string[]>>();
  for (const r of reactionRows) {
    const byEmoji = reactions.get(r.message_id) ?? new Map<string, string[]>();
    byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.user_id]);
    reactions.set(r.message_id, byEmoji);
  }
  const starred = new Set(starRows.map((r) => r.message_id));
  const opened = new Set(openedRows.map((r) => r.message_id));
  const hiddenAt = new Map(hiddenRows.map((r) => [r.message_id, r.hidden_at]));
  const now = Date.now();

  return rows.map((row) => {
    const isSender = row.sender_id === viewerId;
    const expired = row.expire_at !== null && row.expire_at.getTime() <= now;
    const gone = row.deleted_at !== null || hiddenAt.has(row.id) || expired;
    const viewOnceUsed = row.view_once && !isSender && opened.has(row.id);
    const deletedAt = row.deleted_at ?? hiddenAt.get(row.id) ?? (expired ? row.expire_at : null);
    return {
      message_id: row.id,
      conversation_id: row.conversation_id,
      seq: row.seq,
      sender_user_id: row.sender_id,
      client_message_id: isSender ? row.client_message_id : null,
      content: gone || viewOnceUsed ? null : fromRow(row),
      created_at: row.created_at.toISOString(),
      edited_at: row.edited_at?.toISOString() ?? null,
      deleted_at: deletedAt?.toISOString() ?? null,
      expires_at: row.expire_at?.toISOString() ?? null,
      reactions: [...(reactions.get(row.id) ?? [])].map(([emoji, user_ids]) => ({
        emoji,
        user_ids,
      })),
      starred: starred.has(row.id),
      viewed: isSender && row.viewed_at !== null,
    };
  });
}
