import type { ChatPrefs } from '@chat/contracts';
import type { ConversationMembersTable } from '@chat/db';
import { type Updateable, sql } from 'kysely';
import type { Db } from '../../../db.js';
import { MAX_PINNED_CHATS } from '../domain/roles.js';
import { ApiError } from '../http/errors.js';
import { requireActiveMember } from './core.js';
import { toPrefs } from './summaries.js';

export interface PrefsPatch {
  archived?: boolean;
  pinned?: boolean;
  favorite?: boolean;
  muted_until?: string | null;
  wallpaper?: string | null;
  locked?: boolean;
  lock_hash?: string | null;
}

/**
 * Updates the caller's own settings for one chat. These are per-user columns of the
 * membership row, so they never affect other members.
 *
 * Chat lock is a UI convenience: the server keeps the client's passcode hash so the user's
 * other devices can check the passcode, but it never checks it itself and the messages stay
 * readable through the API. It hides the chat in the app, it is not encryption.
 */
export async function updatePrefs(
  db: Db,
  userId: string,
  conversationId: string,
  patch: PrefsPatch,
): Promise<ChatPrefs> {
  return db.transaction().execute(async (trx) => {
    await requireActiveMember(trx, conversationId, userId);
    const set: Updateable<ConversationMembersTable> = {};

    if (patch.archived !== undefined) set.archived = patch.archived;
    if (patch.favorite !== undefined) set.favourite = patch.favorite;
    if (patch.muted_until !== undefined) {
      set.muted_until = patch.muted_until ? new Date(patch.muted_until) : null;
    }
    if (patch.wallpaper !== undefined) set.wallpaper = patch.wallpaper;

    if (patch.locked === false) set.lock_hash = null;
    else if (patch.locked === true || patch.lock_hash) {
      if (!patch.lock_hash)
        throw new ApiError('VALIDATION_FAILED', 'lock_hash is required to lock a chat');
      set.lock_hash = patch.lock_hash;
    }

    if (patch.pinned === false) set.pinned_at = null;
    if (patch.pinned === true) {
      // Two requests pinning at once must not both pass the count, so they queue per user.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'pin:' + userId}))`.execute(trx);
      const mine = await trx
        .selectFrom('conversation_members')
        .select(['conversation_id'])
        .where('user_id', '=', userId)
        .where('left_at', 'is', null)
        .where('pinned_at', 'is not', null)
        .execute();
      const alreadyPinned = mine.some((m) => m.conversation_id === conversationId);
      if (!alreadyPinned && mine.length >= MAX_PINNED_CHATS) {
        throw new ApiError('CONFLICT', `You can pin at most ${MAX_PINNED_CHATS} chats`);
      }
      if (!alreadyPinned) set.pinned_at = new Date();
    }

    const query = trx
      .updateTable('conversation_members')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId);
    const row = await (Object.keys(set).length > 0
      ? query.set(set).returningAll().executeTakeFirstOrThrow()
      : trx
          .selectFrom('conversation_members')
          .selectAll()
          .where('conversation_id', '=', conversationId)
          .where('user_id', '=', userId)
          .executeTakeFirstOrThrow());
    return toPrefs(row);
  });
}
