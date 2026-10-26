import { LIMITS, type ScheduledMessage } from '@chat/contracts';
import type { ScheduledMessagesTable } from '@chat/db';
import type { Selectable } from 'kysely';
import type { Db } from '../../../db.js';
import { ApiError } from '../../users/errors.js';

type Row = Selectable<ScheduledMessagesTable>;

export function toScheduled(row: Row): ScheduledMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    text: row.body_text,
    send_at: row.send_at.toISOString(),
    // Sent rows are never returned (see listScheduled), so only these two can reach a client.
    status: row.status === 'failed' ? 'failed' : 'pending',
    failed_reason: row.failed_reason,
    created_at: row.created_at.toISOString(),
  };
}

/** Waiting (pending) and failed ones, soonest first. Sent ones are ordinary messages by now. */
export async function listScheduled(db: Db, userId: string): Promise<ScheduledMessage[]> {
  const rows = await db
    .selectFrom('scheduled_messages')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '!=', 'sent')
    .orderBy('send_at')
    .limit(LIMITS.MAX_SCHEDULED_PER_USER)
    .execute();
  return rows.map(toScheduled);
}

export async function createScheduled(
  db: Db,
  userId: string,
  conversationId: string,
  input: { text: string; sendAt: Date },
): Promise<ScheduledMessage> {
  const lead = (input.sendAt.getTime() - Date.now()) / 1000;
  if (lead < LIMITS.SCHEDULE_MIN_LEAD_S || lead > LIMITS.SCHEDULE_MAX_LEAD_S) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'Pick a time at least a minute from now and within a year.',
    );
  }
  // A non-member gets the same 404 as a missing conversation.
  const member = await db
    .selectFrom('conversation_members')
    .select('user_id')
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  if (!member) throw new ApiError('NOT_FOUND', 'Conversation not found');

  const waiting = await db
    .selectFrom('scheduled_messages')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('user_id', '=', userId)
    .where('status', '!=', 'sent')
    .executeTakeFirstOrThrow();
  if (Number(waiting.n) >= LIMITS.MAX_SCHEDULED_PER_USER) {
    throw new ApiError('CONFLICT', 'You have too many scheduled messages. Cancel one first.');
  }

  const row = await db
    .insertInto('scheduled_messages')
    .values({
      user_id: userId,
      conversation_id: conversationId,
      body_text: input.text,
      send_at: input.sendAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return toScheduled(row);
}

/**
 * Cancels a waiting or failed message of the caller. A message the worker already sent is a
 * normal message now, so it cannot be cancelled here (404, like one that never existed).
 */
export async function cancelScheduled(db: Db, userId: string, id: string): Promise<void> {
  const deleted = await db
    .deleteFrom('scheduled_messages')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('status', '!=', 'sent')
    .returning('id')
    .executeTakeFirst();
  if (!deleted) throw new ApiError('NOT_FOUND', 'Scheduled message not found');
}

/** Changes the text and/or send time of a waiting message (a failed one is retried at the new time). */
export async function updateScheduled(
  db: Db,
  userId: string,
  id: string,
  input: { text?: string; sendAt?: Date },
): Promise<ScheduledMessage> {
  if (input.sendAt) {
    const lead = (input.sendAt.getTime() - Date.now()) / 1000;
    if (lead < LIMITS.SCHEDULE_MIN_LEAD_S || lead > LIMITS.SCHEDULE_MAX_LEAD_S) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Pick a time at least a minute from now and within a year.',
      );
    }
  }
  const row = await db
    .updateTable('scheduled_messages')
    .set({
      ...(input.text !== undefined ? { body_text: input.text } : {}),
      ...(input.sendAt ? { send_at: input.sendAt, status: 'pending', failed_reason: null } : {}),
    })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('status', '!=', 'sent')
    .returningAll()
    .executeTakeFirst();
  if (!row) throw new ApiError('NOT_FOUND', 'Scheduled message not found');
  return toScheduled(row);
}
