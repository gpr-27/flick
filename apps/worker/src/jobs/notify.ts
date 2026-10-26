import type { Database } from '@chat/db';
import { sql, type Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { isQuietNow } from '../quiet.js';
import { notificationsTotal } from '../metrics.js';
import { emptySummary, type NotificationProvider, type PushSummary } from '../notifications.js';

export const NOTIFY_QUEUE = 'notify';

/** One notification for one user. Enqueued in the same transaction that stores the message. */
export interface NotifyJob {
  user_id: string;
  conversation_id: string;
  message_id: string;
  seq: number;
  /** Why the person is alerted. Jobs queued before this field existed count as plain messages. */
  kind?: 'message' | 'mention' | 'reply';
}

export interface NotifyDeps {
  db: Kysely<Database>;
  provider: NotificationProvider;
}

/**
 * What the job decided, in words for the log:
 *   sent                  at least one push service accepted the push
 *   no_subscription       the person has no working push subscription (the centre row still exists)
 *   all_devices_skipped   every device already had the message or is in quiet hours
 *   push_failed           every attempt was refused (expired subscriptions are disabled)
 *   skipped_gone / skipped_muted / skipped_seen   decided before sending anything
 */
export type NotifyResult =
  | 'sent'
  | 'no_subscription'
  | 'all_devices_skipped'
  | 'push_failed'
  | 'skipped_gone'
  | 'skipped_muted'
  | 'skipped_seen';

export interface NotifyOutcome {
  result: NotifyResult;
  summary: PushSummary;
}

/**
 * The job may run late (retries, a stopped worker, or the short wait given to people whose socket
 * still looked connected), so it decides again with fresh data: the message may be deleted, the
 * user may have muted the chat or left, or may have read it already. Which of their devices
 * already received it is decided per device when sending.
 */
export async function handleNotify(deps: NotifyDeps, job: NotifyJob): Promise<NotifyOutcome> {
  const kind = job.kind ?? 'message';
  const row = await deps.db
    .selectFrom('messages as m')
    .innerJoin('conversation_members as cm', (join) =>
      join.onRef('cm.conversation_id', '=', 'm.conversation_id').on('cm.user_id', '=', job.user_id),
    )
    .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
    .leftJoin('users as sender', 'sender.id', 'm.sender_id')
    .select([
      'm.body_text',
      'm.sender_id',
      'm.type',
      'm.view_once',
      'm.deleted_at',
      'm.seq',
      'sender.display_name as sender_name',
      'c.type as conversation_type',
      'c.name as conversation_name',
      'cm.left_at',
      'cm.read_seq',
      sql<boolean>`coalesce(cm.muted_until > now(), false)`.as('muted'),
      sql<boolean>`(m.expire_at IS NOT NULL AND m.expire_at <= now())`.as('expired'),
    ])
    .where('m.id', '=', job.message_id)
    .executeTakeFirst();

  const skip = (result: NotifyResult): NotifyOutcome => ({ result, summary: emptySummary() });
  if (!row || row.deleted_at || row.expired || row.left_at) return skip('skipped_gone');
  // A muted chat is silent, unless the message names the person or answers one of theirs.
  if (row.muted && kind === 'message') return skip('skipped_muted');
  // Quiet hours: silent unless the sender is one of the person's priority contacts.
  if (await inQuietHours(deps.db, job.user_id, row.sender_id)) return skip('skipped_muted');
  // Read already (for example on another device).
  if (Number(row.read_seq) >= Number(row.seq)) return skip('skipped_seen');

  // The centre lists this alert whether or not any device can be pushed to. (The API may have
  // written it already when the message was dispatched; a message alerts a person once.)
  await deps.db
    .insertInto('notifications')
    .values({
      user_id: job.user_id,
      conversation_id: job.conversation_id,
      message_id: job.message_id,
      kind,
      created_at: sql<Date>`clock_timestamp()`,
    })
    .onConflict((oc) => oc.columns(['user_id', 'message_id']).doNothing())
    .execute();

  const summary = await deps.provider.send({
    user_id: job.user_id,
    conversation_id: job.conversation_id,
    message_id: job.message_id,
    seq: job.seq,
    kind,
    sender_name: row.sender_name ?? 'Someone',
    group_name: row.conversation_type === 'group' ? (row.conversation_name ?? 'Group') : null,
    type: row.type,
    body_text: row.body_text,
    view_once: row.view_once,
  });
  const skipped = summary.skipped_delivered + summary.skipped_quiet;
  const result: NotifyResult =
    summary.sent > 0
      ? 'sent'
      : summary.subscriptions === 0
        ? 'no_subscription'
        : skipped === summary.subscriptions
          ? 'all_devices_skipped'
          : 'push_failed';
  return { result, summary };
}

export async function registerNotify(
  boss: PgBoss,
  deps: NotifyDeps,
  logger: Logger,
): Promise<void> {
  await boss.work<NotifyJob>(NOTIFY_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const base = {
        jobId: job.id,
        userId: job.data.user_id,
        conversationId: job.data.conversation_id,
        messageId: job.data.message_id,
        kind: job.data.kind ?? 'message',
      };
      try {
        const { result, summary } = await handleNotify(deps, job.data);
        notificationsTotal.inc({ result });
        // One line per attempt: why a notification did or did not go out. Hosts and status codes only.
        logger.info({ ...base, result, ...summary }, 'notify');
      } catch (error) {
        notificationsTotal.inc({ result: 'error' });
        const summary = (error as { summary?: PushSummary }).summary;
        logger.warn(
          { ...base, result: 'error', ...summary, err: error },
          'notify failed, will retry',
        );
        throw error;
      }
    }
  });
}

/** The person's quiet hours (settings table), except for messages from priority contacts. */
async function inQuietHours(
  db: NotifyDeps['db'],
  userId: string,
  senderId: string | null,
): Promise<boolean> {
  const s = await db
    .selectFrom('productivity_settings')
    .select([
      'quiet_enabled',
      'quiet_start',
      'quiet_end',
      'quiet_timezone',
      'quiet_days',
      'priority_contacts',
    ])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!s || !isQuietNow(s)) return false;
  return !(senderId && s.priority_contacts.includes(senderId));
}
