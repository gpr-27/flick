import { FLICK_BOT_USER_ID } from '@chat/db';
import { sql } from 'kysely';
import type { Db } from '../../../db.js';
import { ApiError } from '../http/errors.js';
import { lockConversation, requireActiveMember } from './core.js';

/**
 * "Delete chat" for the caller only. Their copy of the messages up to the current last_seq is
 * removed (cleared_seq), and a direct chat leaves their list until somebody sends a newer
 * message; then it comes back showing just the newer messages. Other members are not affected.
 *
 *  - Groups are refused (409): the person has to leave first ("Leave and delete" in the app),
 *    so a deleted group never keeps receiving messages for them in secret.
 *  - The assistant chat and Saved messages keep their chat: this only clears the history.
 */
export async function deleteForMe(db: Db, userId: string, conversationId: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // The lock fixes last_seq for the length of the transaction, so a message arriving right now
    // is either before the cut (removed) or after it (kept), never in between.
    const conv = await lockConversation(trx, conversationId);
    await requireActiveMember(trx, conversationId, userId);
    if (conv.type !== 'direct') {
      throw new ApiError('CONFLICT', 'Leave the group first, then delete it.');
    }

    // direct_pairs keeps the smaller user id first.
    const [lo, hi] =
      userId < FLICK_BOT_USER_ID ? [userId, FLICK_BOT_USER_ID] : [FLICK_BOT_USER_ID, userId];
    const withBot = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM direct_pairs
      WHERE conversation_id = ${conversationId} AND user_lo = ${lo}::uuid AND user_hi = ${hi}::uuid
    `.execute(trx);
    const keepsChat = conv.saved_for !== null || (withBot.rows[0]?.n ?? 0) > 0;

    await trx
      .updateTable('conversation_members')
      .set({
        cleared_seq: conv.last_seq,
        read_seq: conv.last_seq,
        marked_unread: false,
        deleted_at: keepsChat ? null : new Date(),
        ...(keepsChat ? {} : { pinned_at: null, archived: false }),
      })
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .execute();
  });
}
