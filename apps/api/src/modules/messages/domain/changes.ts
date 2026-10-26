import type { MessageContent } from '@chat/contracts';
import { sql } from 'kysely';
import type { AuthContext } from '../../../auth-guard.js';
import { ApiError } from '../errors.js';
import type { MessageDeps } from '../deps.js';
import { loadMessage, lockAndRequireMember, recordChange, requireMember } from '../repo/access.js';
import { TEXT_FIELD } from './content.js';

// Only text and captions can be edited.
const EDITABLE_TYPES = ['text', 'image', 'video', 'file', 'gif'];

interface Target {
  conversationId: string;
  messageId: string;
}

/**
 * Edit: the sender only, any time, text or caption only. The old text goes to message_edits. Takes the next seq.
 * Returns that seq.
 */
export async function editMessage(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target & { content: MessageContent },
): Promise<{ seq: number }> {
  return deps.db.transaction().execute(async (trx) => {
    await lockAndRequireMember(trx, target.conversationId, auth.userId);
    const message = await loadMessage(trx, target.conversationId, target.messageId, {
      forUpdate: true,
    });
    if (message.deleted_at) throw new ApiError('CONFLICT', 'This message was deleted.');
    if (message.sender_id !== auth.userId) {
      throw new ApiError('FORBIDDEN', 'You can only edit your own messages.');
    }
    if (!EDITABLE_TYPES.includes(message.type) || target.content.type !== message.type) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Only the text or caption of a message can be edited.',
      );
    }

    const field = TEXT_FIELD[message.type]!;
    const newText = (target.content as Record<string, unknown>)[field] as string | undefined;
    await trx
      .insertInto('message_edits')
      .values({ message_id: message.id, body_text: message.body_text })
      .execute();
    await trx
      .updateTable('messages')
      .set({ body_text: newText ?? null, edited_at: sql<Date>`now()` })
      .where('id', '=', message.id)
      .execute();
    const seq = await recordChange(trx, {
      conversationId: target.conversationId,
      type: 'edited',
      messageId: message.id,
      userId: auth.userId,
    });
    return { seq };
  });
}

/**
 * Delete.
 *  - "me": hides the message for the caller only. It takes no seq (nobody else is affected).
 *  - "everyone": the sender or a group admin. The row stays as a tombstone (content removed)
 *    so seqs have no holes, and the delete takes a seq so every device learns about it.
 * Returns the seq, or null when nothing was broadcast (delete for me, or already deleted).
 */
export async function deleteMessage(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target & { scope: 'me' | 'everyone' },
): Promise<{ seq: number | null }> {
  if (target.scope === 'me') {
    await requireMember(deps.db, target.conversationId, auth.userId);
    await loadMessage(deps.db, target.conversationId, target.messageId);
    await deps.db
      .insertInto('hidden_messages')
      .values({ user_id: auth.userId, message_id: target.messageId })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return { seq: null };
  }

  return deps.db.transaction().execute(async (trx) => {
    const member = await lockAndRequireMember(trx, target.conversationId, auth.userId);
    const message = await loadMessage(trx, target.conversationId, target.messageId, {
      forUpdate: true,
    });
    if (message.deleted_at) return { seq: null }; // a retry: already done, no second seq
    const isSender = message.sender_id === auth.userId;
    const isAdmin = member.role === 'owner' || member.role === 'admin';
    if (!isSender && !isAdmin) {
      throw new ApiError('FORBIDDEN', 'Only the sender or a group admin can delete for everyone.');
    }

    await trx
      .updateTable('messages')
      .set({
        deleted_at: sql<Date>`now()`,
        body_text: null,
        content: null,
        attachment_id: null,
      })
      .where('id', '=', message.id)
      .execute();
    await trx.deleteFrom('pinned_messages').where('message_id', '=', message.id).execute();
    const seq = await recordChange(trx, {
      conversationId: target.conversationId,
      type: 'deleted',
      messageId: message.id,
      userId: auth.userId,
    });
    return { seq };
  });
}

/**
 * React. One reaction per user per message: a new emoji replaces the old one (a single
 * reaction_added event; clients replace that user's reaction). The same emoji again is a
 * no-op and takes no seq. Returns the seq, or null for a no-op.
 */
export async function reactToMessage(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target & { emoji: string },
): Promise<{ seq: number | null }> {
  return deps.db.transaction().execute(async (trx) => {
    await lockAndRequireMember(trx, target.conversationId, auth.userId);
    const message = await loadMessage(trx, target.conversationId, target.messageId);
    if (message.deleted_at) throw new ApiError('CONFLICT', 'This message was deleted.');

    const existing = await trx
      .selectFrom('reactions')
      .select('emoji')
      .where('message_id', '=', message.id)
      .where('user_id', '=', auth.userId)
      .executeTakeFirst();
    if (existing?.emoji === target.emoji) return { seq: null };

    await trx
      .deleteFrom('reactions')
      .where('message_id', '=', message.id)
      .where('user_id', '=', auth.userId)
      .execute();
    await trx
      .insertInto('reactions')
      .values({ message_id: message.id, user_id: auth.userId, emoji: target.emoji })
      .execute();
    const seq = await recordChange(trx, {
      conversationId: target.conversationId,
      type: 'reaction_added',
      messageId: message.id,
      userId: auth.userId,
      emoji: target.emoji,
    });
    return { seq };
  });
}

/** Removes the caller's reaction. Takes a seq only if there was a reaction to remove. */
export async function removeReaction(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target,
): Promise<{ seq: number | null }> {
  return deps.db.transaction().execute(async (trx) => {
    await lockAndRequireMember(trx, target.conversationId, auth.userId);
    const message = await loadMessage(trx, target.conversationId, target.messageId);
    const removed = await trx
      .deleteFrom('reactions')
      .where('message_id', '=', message.id)
      .where('user_id', '=', auth.userId)
      .returning('emoji')
      .executeTakeFirst();
    if (!removed) return { seq: null };
    const seq = await recordChange(trx, {
      conversationId: target.conversationId,
      type: 'reaction_removed',
      messageId: message.id,
      userId: auth.userId,
      emoji: removed.emoji,
    });
    return { seq };
  });
}
