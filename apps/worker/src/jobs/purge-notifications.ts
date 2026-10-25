import type { Database } from '@chat/db';
import { sql, type Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';

export const PURGE_NOTIFICATIONS_QUEUE = 'purge-notifications';

/** The notification centre keeps 30 days (the API also stops listing older rows). */
export const KEEP_DAYS = 30;

/** Deletes alerts older than 30 days. Returns how many went. */
export async function purgeOldNotifications(db: Kysely<Database>): Promise<number> {
  const result = await sql`
    DELETE FROM notifications WHERE created_at < now() - make_interval(days => ${KEEP_DAYS})
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export async function registerPurgeNotifications(
  boss: PgBoss,
  db: Kysely<Database>,
  logger: Logger,
): Promise<void> {
  await boss.createQueue(PURGE_NOTIFICATIONS_QUEUE);
  await boss.work(PURGE_NOTIFICATIONS_QUEUE, async () => {
    logger.info({ purged: await purgeOldNotifications(db) }, 'purge-notifications finished');
  });
  await boss.schedule(PURGE_NOTIFICATIONS_QUEUE, '17 * * * *'); // hourly; cheap thanks to the index
}
