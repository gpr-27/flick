import {
  FLICK_BOT_USER_ID,
  allocateSeqAndInsertMessage,
  contextKey,
  loadReminderContexts,
  type Database,
  type ReminderContext,
} from '@chat/db';
import type { Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { reminderPushTotal } from '../metrics.js';
import { pushToUser, type PushSender } from '../web-push-provider.js';

export const SEND_REMINDERS_QUEUE = 'send-reminders';
export const REMINDER_PUSH_QUEUE = 'reminder-push';
/** Due reminders handled per run; if more are due, the next run (a minute later) takes the rest. */
const BATCH = 200;

export const GONE_TEXT = 'A message you wanted to be reminded about was deleted.';

/** The push job. It carries only ids: the text is read again when the push is sent. */
export interface ReminderPushJob {
  reminder_id: string;
  /** The Flick chat message that was posted; used as the notification tag so it shows once. */
  bot_message_id: string | null;
}

/** Queues the push for a reminder that was just delivered. Injected so tests need no pg-boss. */
export type EnqueueReminderPush = (job: ReminderPushJob) => Promise<void>;

/** Markdown characters in a name or quote are escaped so they cannot format the message. */
const escapeMarkdown = (text: string): string => text.replace(/([\\`*_{}[\]()#+\-.!|~>])/g, '\\$1');

/** The text of the Flick chat message. `[Open chat](/?c=id)` is turned into a button by the web app. */
export function reminderMessageText(
  context: ReminderContext,
  note: string | null,
  conversationId: string,
): string {
  const lines = ['⏰ **Reminder**'];
  if (context.messageGone) {
    lines.push(`${escapeMarkdown(GONE_TEXT)} (${escapeMarkdown(context.chatName)})`);
  } else if (context.quote !== null) {
    lines.push(`"${escapeMarkdown(context.quote)}"`);
    const author = context.author ? `${escapeMarkdown(context.author)} in ` : 'In ';
    lines.push(`${author}${escapeMarkdown(context.chatName)}`);
  } else {
    lines.push(`About your chat with ${escapeMarkdown(context.chatName)}`);
  }
  if (note) lines.push(`Note: ${escapeMarkdown(note)}`);
  lines.push(`[Open chat](/?c=${conversationId})`);
  return lines.join('\n');
}

/** The short text of the push notification (plain text; the title is "Reminder"). */
export function reminderPushBody(context: ReminderContext, note: string | null): string {
  const parts: string[] = [];
  if (context.messageGone) parts.push(GONE_TEXT);
  else if (context.quote !== null) {
    parts.push(`"${context.quote}"${context.author ? ` - ${context.author}` : ''}`);
  } else parts.push(`Your chat with ${context.chatName}`);
  if (note) parts.push(note);
  return parts.join(' | ');
}

/**
 * Delivers the reminders whose time has come, each exactly once.
 *
 * The reminders row is the durable record (pg-boss only wakes this job up). Each reminder is
 * handled in ONE transaction that locks the row (SKIP LOCKED, so two workers never take the same
 * one), posts the Flick chat message and marks the row 'sent'. A crash can neither lose nor
 * repeat it. The push is queued after the commit: it is a second, independent channel, so a
 * failure in one of the two never blocks the other.
 */
export async function sendDueReminders(
  db: Kysely<Database>,
  enqueuePush: EnqueueReminderPush,
  logger?: Logger,
) {
  const due = await db
    .selectFrom('reminders')
    .select('id')
    .where('status', '=', 'pending')
    .where('remind_at', '<=', new Date())
    .orderBy('remind_at')
    .limit(BATCH)
    .execute();
  let sent = 0;
  for (const { id } of due) {
    const delivered = await deliverOne(db, id, logger);
    if (!delivered) continue;
    sent++;
    try {
      await enqueuePush({ reminder_id: id, bot_message_id: delivered.botMessageId });
    } catch (error) {
      logger?.warn({ err: error, reminderId: id }, 'could not queue the reminder push');
    }
  }
  return { sent };
}

async function deliverOne(
  db: Kysely<Database>,
  id: string,
  logger?: Logger,
): Promise<{ botMessageId: string | null } | null> {
  // A controlled transaction (begin / commit by hand) is needed for the savepoint below.
  const trx = await db.startTransaction().execute();
  try {
    const row = await trx
      .selectFrom('reminders')
      .selectAll()
      .where('id', '=', id)
      .where('status', '=', 'pending') // cancelled or taken by another worker: nothing to do
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) {
      await trx.rollback().execute();
      return null;
    }

    let botMessageId: string | null = null;
    // The savepoint keeps a failure of the chat message from aborting the whole transaction, so
    // the reminder is still marked sent and the push still goes out.
    const savepoint = await trx.savepoint('in_app').execute();
    try {
      const chatId = await flickChatOf(trx, row.user_id);
      if (chatId) {
        const contexts = await loadReminderContexts(trx, [row]);
        const message = await allocateSeqAndInsertMessage(trx, {
          conversationId: chatId,
          senderId: FLICK_BOT_USER_ID,
          senderDeviceId: null,
          clientMessageId: null,
          type: 'text',
          bodyText: reminderMessageText(
            contexts.get(contextKey(row))!,
            row.note,
            row.conversation_id,
          ),
          content: { reminder_id: row.id },
          authorize: false, // like every bot message
        });
        botMessageId = message.message.id;
      } else {
        logger?.info({ reminderId: id }, 'no Flick chat for this person: reminder push only');
      }
    } catch (error) {
      await savepoint.rollbackToSavepoint('in_app').execute();
      logger?.warn({ err: error, reminderId: id }, 'could not post the reminder in the Flick chat');
    }

    await trx
      .updateTable('reminders')
      .set({ status: 'sent', sent_at: new Date() })
      .where('id', '=', id)
      .execute();
    await trx.commit().execute();
    return { botMessageId };
  } catch (error) {
    await trx.rollback().execute();
    throw error;
  }
}

/** The person's one-to-one chat with the Flick bot, or null if they have none. */
export async function flickChatOf(db: Kysely<Database>, userId: string): Promise<string | null> {
  const [lo, hi] =
    userId < FLICK_BOT_USER_ID ? [userId, FLICK_BOT_USER_ID] : [FLICK_BOT_USER_ID, userId];
  const pair = await db
    .selectFrom('direct_pairs')
    .innerJoin('conversation_members as cm', (join) =>
      join
        .onRef('cm.conversation_id', '=', 'direct_pairs.conversation_id')
        .on('cm.user_id', '=', userId),
    )
    .select('direct_pairs.conversation_id')
    .where('user_lo', '=', lo)
    .where('user_hi', '=', hi)
    .where('cm.left_at', 'is', null)
    .executeTakeFirst();
  return pair?.conversation_id ?? null;
}

export interface ReminderPushDeps {
  db: Kysely<Database>;
  /** null when no VAPID keys are set: the push is only logged, nothing is sent. */
  sender: PushSender | null;
  logger: Logger;
}

export type ReminderPushResult = 'sent' | 'simulated' | 'skipped';

// A reminder is worth showing for a while, but it is not urgent.
const PUSH_OPTIONS = { ttlSeconds: 86_400, urgency: 'normal' } as const;

/** Sends the Web Push for one delivered reminder. Same payload shape as a message push. */
export async function handleReminderPush(
  deps: ReminderPushDeps,
  job: ReminderPushJob,
): Promise<ReminderPushResult> {
  const row = await deps.db
    .selectFrom('reminders')
    .selectAll()
    .where('id', '=', job.reminder_id)
    .where('status', '=', 'sent')
    .executeTakeFirst();
  if (!row) return 'skipped';
  if (!deps.sender) {
    deps.logger.info(
      { simulated: true, reminderId: row.id, userId: row.user_id },
      'SIMULATED reminder push (nothing was sent)',
    );
    return 'simulated';
  }
  const context = (await loadReminderContexts(deps.db, [row])).get(contextKey(row))!;
  const payload = JSON.stringify({
    title: 'Reminder',
    body: reminderPushBody(context, row.note),
    conversation_id: row.conversation_id,
    // The same tag as the Flick chat message's own push, so a phone shows one notification.
    message_id: job.bot_message_id ?? row.id,
  });
  await pushToUser(deps.db, deps.sender, deps.logger, row.user_id, payload, PUSH_OPTIONS);
  return 'sent';
}

export async function registerSendReminders(
  boss: PgBoss,
  db: Kysely<Database>,
  pushDeps: ReminderPushDeps,
  logger: Logger,
): Promise<void> {
  await boss.work<ReminderPushJob>(REMINDER_PUSH_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await handleReminderPush(pushDeps, job.data);
      reminderPushTotal.inc({ result });
      logger.debug({ jobId: job.id, result }, 'reminder push job handled');
    }
  });
  await boss.work(SEND_REMINDERS_QUEUE, async () => {
    const result = await sendDueReminders(
      db,
      async (job) => {
        // One push per reminder, even if this is queued twice.
        await boss.send(REMINDER_PUSH_QUEUE, job, { singletonKey: job.reminder_id });
      },
      logger,
    );
    if (result.sent > 0) logger.info(result, 'send-reminders finished');
  });
  await boss.schedule(SEND_REMINDERS_QUEUE, '* * * * *'); // reminder times are minute-precise
}
