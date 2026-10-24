import { DbError, allocateSeqAndInsertMessage, type Database } from '@chat/db';
import type { Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';

export const SEND_SCHEDULED_QUEUE = 'send-scheduled';
/** Due messages handled per run; if more are due, the next run (a minute later) takes the rest. */
const BATCH = 200;

/** A reason the message must not be sent that the database itself does not check. */
class Unsendable extends Error {}

/**
 * Sends the scheduled messages whose time has come, each exactly once.
 *
 * The scheduled_messages row is the durable record (pg-boss only wakes this job up). Each message
 * is sent in ONE transaction that also marks the row 'sent', so a crash can neither lose it nor
 * send it twice. The row is locked with SKIP LOCKED, so two workers never take the same one.
 * Membership is checked now, not when it was scheduled: someone who left the group in between
 * gets a 'failed' row (shown in their Scheduled list) instead of a message.
 */
export async function sendDueScheduled(db: Kysely<Database>) {
  const due = await db
    .selectFrom('scheduled_messages')
    .select('id')
    .where('status', '=', 'pending')
    .where('send_at', '<=', new Date())
    .orderBy('send_at')
    .limit(BATCH)
    .execute();
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    const outcome = await sendOne(db, id);
    if (outcome === 'sent') sent++;
    if (outcome === 'failed') failed++;
  }
  return { sent, failed };
}

async function sendOne(db: Kysely<Database>, id: string): Promise<'sent' | 'failed' | 'skipped'> {
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('scheduled_messages')
        .selectAll()
        .where('id', '=', id)
        .where('status', '=', 'pending') // cancelled or taken by another worker: nothing to do
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return 'skipped';

      const blocked = await trx
        .selectFrom('conversation_members as other')
        .innerJoin('conversations as c', 'c.id', 'other.conversation_id')
        .innerJoin('blocks as b', (join) =>
          join.onRef('b.blocker_id', '=', 'other.user_id').on('b.blocked_id', '=', row.user_id),
        )
        .select('other.user_id')
        .where('other.conversation_id', '=', row.conversation_id)
        .where('c.type', '=', 'direct')
        .executeTakeFirst();
      if (blocked) throw new Unsendable('The other person has blocked you.');

      // Checks that the sender is still a member and may post (it throws a DbError if not).
      await allocateSeqAndInsertMessage(trx, {
        conversationId: row.conversation_id,
        senderId: row.user_id,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'text',
        bodyText: row.body_text,
      });
      await trx
        .updateTable('scheduled_messages')
        .set({ status: 'sent' })
        .where('id', '=', id)
        .execute();
      return 'sent';
    });
  } catch (error) {
    // The transaction rolled back, so the row is still pending: record why it was not sent.
    const reason = failureReason(error);
    if (!reason) throw error; // a real fault (database down...): let the job fail and run again
    await db
      .updateTable('scheduled_messages')
      .set({ status: 'failed', failed_reason: reason })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .execute();
    return 'failed';
  }
}

function failureReason(error: unknown): string | null {
  if (error instanceof Unsendable) return error.message;
  if (error instanceof DbError) {
    if (error.code === 'not_a_member') return 'You are no longer in this chat.';
    if (error.code === 'not_allowed') return 'Only admins can send messages in this group.';
    if (error.code === 'conversation_not_found') return 'This chat no longer exists.';
  }
  return null;
}

export async function registerSendScheduled(
  boss: PgBoss,
  db: Kysely<Database>,
  logger: Logger,
): Promise<void> {
  await boss.work(SEND_SCHEDULED_QUEUE, async () => {
    const result = await sendDueScheduled(db);
    if (result.sent + result.failed > 0) logger.info(result, 'send-scheduled finished');
  });
  await boss.schedule(SEND_SCHEDULED_QUEUE, '* * * * *'); // every minute: send times are minute-precise
}
