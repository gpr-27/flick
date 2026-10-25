import { LIMITS, type Reminder } from '@chat/contracts';
import { contextKey, loadReminderContexts, type RemindersTable } from '@chat/db';
import { sql, type Selectable } from 'kysely';
import type { Db } from '../../../db.js';
import { decodeCursor, encodeCursor } from '../../conversations/repo/cursor.js';
import { ApiError } from '../../users/errors.js';

type Row = Selectable<RemindersTable>;

// The two parts of a cursor, checked before they reach SQL casts: "2030-01-01 09:00:00+00|<uuid>".
const CURSOR_TIME = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d(:?\d\d)?)?$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds the API shape. The quote is read from the message now; it is never stored. */
async function toReminders(db: Db, rows: Row[]): Promise<Reminder[]> {
  const contexts = await loadReminderContexts(db, rows);
  return rows.map((row) => {
    const context = contexts.get(contextKey(row))!;
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      note: row.note,
      remind_at: row.remind_at.toISOString(),
      // Cancelled reminders are deleted, so only these two can reach a client.
      status: row.status === 'sent' ? 'sent' : 'pending',
      created_at: row.created_at.toISOString(),
      sent_at: row.sent_at?.toISOString() ?? null,
      quote: context.quote,
      author_name: context.author,
      chat_name: context.chatName,
      message_gone: context.messageGone,
    };
  });
}

export interface NewReminder {
  messageId?: string | undefined;
  conversationId?: string | undefined;
  remindAt: Date;
  note?: string | undefined;
}

export async function createReminder(
  db: Db,
  userId: string,
  input: NewReminder,
): Promise<Reminder> {
  const lead = (input.remindAt.getTime() - Date.now()) / 1000;
  if (lead < LIMITS.REMINDER_MIN_LEAD_S || lead > LIMITS.REMINDER_MAX_LEAD_S) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'Pick a time at least a minute from now and within a year.',
    );
  }

  // The chat comes from the message when there is one. A message that is in another chat, was
  // deleted, or is hidden by this person gets the same 404 as one that never existed.
  let conversationId = input.conversationId;
  if (input.messageId) {
    const message = await db
      .selectFrom('messages as m')
      .select(['m.conversation_id', 'm.deleted_at'])
      .where('m.id', '=', input.messageId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('hidden_messages as h')
              .select('h.message_id')
              .whereRef('h.message_id', '=', 'm.id')
              .where('h.user_id', '=', userId),
          ),
        ),
      )
      .executeTakeFirst();
    if (
      !message ||
      message.deleted_at ||
      (conversationId && conversationId !== message.conversation_id)
    ) {
      throw new ApiError('NOT_FOUND', 'Message not found');
    }
    conversationId = message.conversation_id;
  }

  // A non-member gets the same 404 as a missing conversation.
  const member = await db
    .selectFrom('conversation_members')
    .select('user_id')
    .where('conversation_id', '=', conversationId!)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  if (!member) throw new ApiError('NOT_FOUND', 'Conversation not found');

  const row = await db.transaction().execute(async (trx) => {
    // One lock per person, so two requests at the same moment cannot both pass the limit.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'reminders:' + userId}))`.execute(trx);
    const waiting = await trx
      .selectFrom('reminders')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('user_id', '=', userId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    if (Number(waiting.n) >= LIMITS.MAX_PENDING_REMINDERS_PER_USER) {
      throw new ApiError('CONFLICT', 'You have too many reminders. Cancel one first.');
    }
    return trx
      .insertInto('reminders')
      .values({
        user_id: userId,
        conversation_id: conversationId!,
        message_id: input.messageId ?? null,
        note: input.note ?? null,
        remind_at: input.remindAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return (await toReminders(db, [row]))[0]!;
}

// decodeCursor throws the conversations module's error type, which this module's routes do not
// translate, so a bad cursor is turned into this module's own 400 here.
function splitCursor(cursor: string): string[] {
  try {
    return decodeCursor(cursor).split('|');
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
  }
}

/**
 * Waiting reminders and the ones sent in the last few days, soonest first. The cursor is
 * "remind_at|id" of the last row (as text, which keeps microseconds a JS Date would round off).
 */
export async function listReminders(
  db: Db,
  userId: string,
  query: { cursor?: string | undefined; limit: number },
): Promise<{ items: Reminder[]; next_cursor: string | null }> {
  const after = query.cursor ? splitCursor(query.cursor) : null;
  if (after && (after.length !== 2 || !CURSOR_TIME.test(after[0]!) || !CURSOR_ID.test(after[1]!))) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
  }
  const rows = await db
    .selectFrom('reminders')
    .selectAll()
    .select(sql<string>`remind_at::text`.as('remind_text'))
    .where('user_id', '=', userId)
    .where((eb) =>
      eb.or([
        eb('status', '=', 'pending'),
        eb.and([
          eb('status', '=', 'sent'),
          eb(
            'sent_at',
            '>',
            sql<Date>`now() - make_interval(secs => ${LIMITS.REMINDER_SENT_VISIBLE_S})`,
          ),
        ]),
      ]),
    )
    .$if(after !== null, (qb) =>
      qb.where(sql<boolean>`(remind_at, id) > (${after![0]}::timestamptz, ${after![1]}::uuid)`),
    )
    .orderBy('remind_at')
    .orderBy('id')
    .limit(query.limit + 1)
    .execute();
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: await toReminders(db, page),
    next_cursor:
      rows.length > query.limit && last ? encodeCursor(`${last.remind_text}|${last.id}`) : null,
  };
}

/**
 * Cancels a waiting reminder of the caller. A sent one is history (404, like one that never
 * existed); someone else's reminder is also a 404, so ids cannot be probed.
 */
export async function cancelReminder(db: Db, userId: string, id: string): Promise<void> {
  const deleted = await db
    .deleteFrom('reminders')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .returning('id')
    .executeTakeFirst();
  if (!deleted) throw new ApiError('NOT_FOUND', 'Reminder not found');
}
