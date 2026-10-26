import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage, type Database } from '@chat/db';
import { sql, type Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { flickChatOf } from './send-reminders.js';

export const DIGEST_QUEUE = 'send-digest';
/** The briefing goes out at this local hour (in the person's own time zone). */
const DIGEST_HOUR = 8;
/** Weekly digests go out on Monday. */
const WEEKLY_DAY = 'Mon';

/** The local hour and weekday of `now` in a time zone, or null when the zone is unknown. */
export function localParts(now: Date, timeZone: string): { hour: number; weekday: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(now);
    return {
      hour: Number(parts.find((p) => p.type === 'hour')?.value),
      weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
    };
  } catch {
    return null;
  }
}

/** Posts the morning briefing in the Flick chat of everyone whose digest is due. */
export async function sendDigests(db: Kysely<Database>, logger?: Logger, now = new Date()) {
  const people = await db
    .selectFrom('productivity_settings')
    .select(['user_id', 'digest', 'quiet_timezone'])
    .where('digest', '!=', 'off')
    // Sent at most once per 6 days (weekly) or 20 hours (daily); checked again below.
    .where((eb) =>
      eb.or([
        eb('last_digest_at', 'is', null),
        eb('last_digest_at', '<', new Date(now.getTime() - 20 * 3_600_000)),
      ]),
    )
    .limit(500)
    .execute();
  let sent = 0;
  for (const person of people) {
    const local = localParts(now, person.quiet_timezone);
    if (!local || local.hour !== DIGEST_HOUR) continue;
    if (person.digest === 'weekly' && local.weekday !== WEEKLY_DAY) continue;
    try {
      if (await sendOne(db, person.user_id, now)) sent++;
    } catch (error) {
      logger?.warn({ err: error, userId: person.user_id }, 'could not send the digest');
    }
  }
  return { sent };
}

async function sendOne(db: Kysely<Database>, userId: string, now: Date): Promise<boolean> {
  const chatId = await flickChatOf(db, userId);
  if (!chatId) return false;
  const due = await db
    .selectFrom('reminders')
    .select(['note', 'remind_at'])
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .where('remind_at', '<=', new Date(now.getTime() + 24 * 3_600_000))
    .orderBy('remind_at')
    .limit(5)
    .execute();
  const unread = await db
    .selectFrom('conversation_members as cm')
    .innerJoin('conversations as c', 'c.id', 'cm.conversation_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('cm.user_id', '=', userId)
    .where('cm.left_at', 'is', null)
    .where(sql<boolean>`c.last_seq > cm.read_seq`)
    .where(sql<boolean>`c.saved_for IS NULL`)
    .executeTakeFirst();
  const saved = await db
    .selectFrom('messages as m')
    .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('c.saved_for', '=', userId)
    .where('m.deleted_at', 'is', null)
    .executeTakeFirst();

  const lines = ['☀️ **Your briefing**'];
  lines.push(
    due.length === 0
      ? 'No reminders coming up.'
      : `Reminders: ${due.map((r) => (r.note ?? 'Reminder').replace(/([\\`*_{}[\]()#+\-.!|~>])/g, '\\$1')).join(', ')}`,
  );
  lines.push(`Chats waiting: ${Number(unread?.n ?? 0)}`);
  lines.push(`Saved items: ${Number(saved?.n ?? 0)}`);
  const text = lines.join('\n');

  const trx = await db.startTransaction().execute();
  try {
    await allocateSeqAndInsertMessage(trx, {
      conversationId: chatId,
      senderId: FLICK_BOT_USER_ID,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: text,
      content: { digest: true },
      authorize: false,
    });
    await trx
      .updateTable('productivity_settings')
      .set({ last_digest_at: now })
      .where('user_id', '=', userId)
      .execute();
    await trx.commit().execute();
    return true;
  } catch (error) {
    await trx.rollback().execute();
    throw error;
  }
}

export async function registerDigest(
  boss: PgBoss,
  db: Kysely<Database>,
  logger: Logger,
): Promise<void> {
  await boss.work(DIGEST_QUEUE, async () => {
    const result = await sendDigests(db, logger);
    if (result.sent > 0) logger.info(result, 'send-digest finished');
  });
  await boss.schedule(DIGEST_QUEUE, '5 * * * *'); // hourly; each person's own 8 am is picked here
}
