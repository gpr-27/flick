import { purgeOldOutboxRows, type Database } from '@chat/db';
import { sql, type Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { messagesExpiredTotal } from '../metrics.js';

export const EXPIRE_QUEUE = 'expire-messages';
const BATCH = 1_000;

/**
 * Disappearing messages: turns every message past `expire_at` into a tombstone. The row and its
 * seq stay (so sync has no gaps); the text, content and attachment link are erased.
 * Then it trims old outbox and processed_events rows, so those tables stay small.
 */
export async function expireMessages(db: Kysely<Database>) {
  let expired = 0;
  for (;;) {
    const result = await sql`
      UPDATE messages
      SET deleted_at = now(), body_text = NULL, content = NULL, attachment_id = NULL, mentions = '{}'
      WHERE id IN (
        SELECT id FROM messages
        WHERE expire_at <= now() AND deleted_at IS NULL
        LIMIT ${BATCH}
      )`.execute(db);
    const count = Number(result.numAffectedRows ?? 0);
    expired += count;
    if (count < BATCH) break;
  }
  messagesExpiredTotal.inc(expired);
  const purged = await purgeOldOutboxRows(db);
  return { expired, ...purged };
}

export async function registerExpireMessages(
  boss: PgBoss,
  db: Kysely<Database>,
  logger: Logger,
): Promise<void> {
  await boss.work(EXPIRE_QUEUE, async () => {
    logger.info(await expireMessages(db), 'expire-messages finished');
  });
  await boss.schedule(EXPIRE_QUEUE, '*/5 * * * *'); // timers are whole days, so 5 minutes is precise enough
}
