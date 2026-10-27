import { MESSAGE_COLUMNS, MESSAGE_TOPIC, type MemberRole, type MessageEventType } from '@chat/db';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../../db.js';
import { ApiError } from '../errors.js';

type Q = Kysely<Database>;

/** Throws NOT_A_MEMBER unless the user is currently in the conversation. */
export async function requireMember(db: Q, conversationId: string, userId: string) {
  const member = await db
    .selectFrom('conversation_members')
    .select(['role', 'read_seq'])
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  if (!member) throw new ApiError('NOT_A_MEMBER', 'You are not a member of this conversation.');
  return member;
}

/**
 * First step of every change that takes a seq: lock the conversation row, then check the user.
 * Everything that allocates a seq (sending, editing, deleting, reacting) locks this same row
 * first, so seqs are handed out one at a time and in commit order.
 */
export async function lockAndRequireMember(
  trx: Q,
  conversationId: string,
  userId: string,
): Promise<{ role: MemberRole }> {
  await sql`SELECT 1 FROM conversations WHERE id = ${conversationId} FOR UPDATE`.execute(trx);
  return requireMember(trx, conversationId, userId);
}

const OUTBOX_TYPE: Record<MessageEventType, string> = {
  edited: 'message.edited',
  deleted: 'message.deleted',
  reaction_added: 'reaction.added',
  reaction_removed: 'reaction.removed',
};

/**
 * Takes the next seq for a change (edit, delete, reaction), logs it in message_events for sync,
 * and writes the outbox row. Call it inside a transaction that already holds the conversation
 * lock; the change itself must be in that same transaction.
 */
export async function recordChange(
  trx: Q,
  change: {
    conversationId: string;
    type: MessageEventType;
    messageId: string;
    userId: string;
    emoji?: string;
  },
): Promise<number> {
  const { last_seq: seq } = await trx
    .updateTable('conversations')
    .set((eb) => ({ last_seq: eb('last_seq', '+', 1) }))
    .where('id', '=', change.conversationId)
    .returning('last_seq')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('message_events')
    .values({
      conversation_id: change.conversationId,
      seq,
      type: change.type,
      message_id: change.messageId,
      user_id: change.userId,
      emoji: change.emoji ?? null,
    })
    .execute();
  await trx
    .insertInto('outbox')
    .values({
      topic: MESSAGE_TOPIC,
      partition_key: change.conversationId,
      payload: {
        type: OUTBOX_TYPE[change.type],
        conversation_id: change.conversationId,
        message_id: change.messageId,
        seq,
        user_id: change.userId,
        ...(change.emoji ? { emoji: change.emoji } : {}),
      },
    })
    .execute();
  return seq;
}

/**
 * Loads a message of this conversation that the caller can still act on: it must exist and
 * must not have expired. `forUpdate` locks the row for the rest of the transaction.
 */
export async function loadMessage(
  db: Q,
  conversationId: string,
  messageId: string,
  options: { forUpdate?: boolean } = {},
) {
  let q = db
    .selectFrom('messages')
    .select(MESSAGE_COLUMNS)
    .where('id', '=', messageId)
    .where('conversation_id', '=', conversationId)
    .where(sql<boolean>`(expire_at IS NULL OR expire_at > now())`);
  if (options.forUpdate) q = q.forUpdate();
  const message = await q.executeTakeFirst();
  if (!message) throw new ApiError('NOT_FOUND', 'Message not found.');
  return message;
}
