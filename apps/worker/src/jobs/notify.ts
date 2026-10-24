import type { Database } from '@chat/db';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { notificationsTotal } from '../metrics.js';
import type { NotificationProvider } from '../notifications.js';

export const NOTIFY_QUEUE = 'notify';

/** One notification for one user. Enqueued in the same transaction that stores the message. */
export interface NotifyJob {
  user_id: string;
  conversation_id: string;
  message_id: string;
  seq: number;
}

export interface NotifyDeps {
  db: Kysely<Database>;
  redis: Redis;
  provider: NotificationProvider;
}

export type NotifyResult = 'sent' | 'skipped_gone' | 'skipped_muted' | 'skipped_online';

// Same meaning as the API's presence (see docs/messaging/gateway-notes.md): `presence:user:<id>` is a
// sorted set of socket ids scored by when each entry expires, so online = at least one entry that
// has not expired yet.
async function isOnline(redis: Redis, userId: string): Promise<boolean> {
  return (await redis.zcount(`presence:user:${userId}`, Date.now(), '+inf')) > 0;
}

const excerptOf = (text: string | null, type: string): string => {
  if (!text) return `Sent a ${type.replace('_', ' ')}`;
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
};

/**
 * The job may run late (retries, a stopped worker), so it decides again with fresh data:
 * the message may be deleted, the user may have muted the chat or left, or may be online by now
 * (then the live connection already delivered it).
 */
export async function handleNotify(deps: NotifyDeps, job: NotifyJob): Promise<NotifyResult> {
  const row = await deps.db
    .selectFrom('messages as m')
    .innerJoin('conversation_members as cm', (join) =>
      join.onRef('cm.conversation_id', '=', 'm.conversation_id').on('cm.user_id', '=', job.user_id),
    )
    .leftJoin('users as sender', 'sender.id', 'm.sender_id')
    .select([
      'm.body_text',
      'm.type',
      'm.deleted_at',
      'sender.display_name as sender_name',
      'cm.left_at',
      sql<boolean>`coalesce(cm.muted_until > now(), false)`.as('muted'),
    ])
    .where('m.id', '=', job.message_id)
    .executeTakeFirst();

  if (!row || row.deleted_at || row.left_at) return 'skipped_gone';
  if (row.muted) return 'skipped_muted';
  if (await isOnline(deps.redis, job.user_id)) return 'skipped_online';

  await deps.provider.send({
    ...job,
    sender_name: row.sender_name ?? 'Someone',
    excerpt: excerptOf(row.body_text, row.type),
  });
  return 'sent';
}

export async function registerNotify(
  boss: PgBoss,
  deps: NotifyDeps,
  logger: Logger,
): Promise<void> {
  await boss.work<NotifyJob>(NOTIFY_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await handleNotify(deps, job.data);
      notificationsTotal.inc({ result });
      logger.debug({ jobId: job.id, userId: job.data.user_id, result }, 'notify job handled');
    }
  });
}
