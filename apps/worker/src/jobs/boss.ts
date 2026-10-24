import type { Database } from '@chat/db';
import type { Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { EXPIRE_QUEUE, registerExpireMessages } from './expire-messages.js';
import { NOTIFY_QUEUE, registerNotify, type NotifyDeps } from './notify.js';
import { SEND_SCHEDULED_QUEUE, registerSendScheduled } from './send-scheduled.js';
import { SWEEP_UPLOADS_QUEUE, registerSweepUploads, type UploadStorage } from './sweep-uploads.js';

/**
 * Starts pg-boss (it creates its own `pgboss` schema on first start) and registers the jobs.
 * `storage` is undefined when object storage is not configured; then there is nothing to sweep.
 */
export async function startJobs(deps: {
  boss: PgBoss;
  db: Kysely<Database>;
  logger: Logger;
  notify: NotifyDeps;
  storage: UploadStorage | undefined;
}): Promise<void> {
  const { boss, db, logger, notify, storage } = deps;
  boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
  await boss.start();
  // A failed notify job is retried 5 times with growing delays: 10s, 20s, 40s, ...
  await boss.createQueue(NOTIFY_QUEUE, { retryLimit: 5, retryDelay: 10, retryBackoff: true });
  await boss.createQueue(EXPIRE_QUEUE);
  await registerNotify(boss, notify, logger);
  await registerExpireMessages(boss, db, logger);
  await boss.createQueue(SEND_SCHEDULED_QUEUE);
  await registerSendScheduled(boss, db, logger);
  if (storage) {
    await boss.createQueue(SWEEP_UPLOADS_QUEUE);
    await registerSweepUploads(boss, db, storage, logger);
  }
}

/** Lets running jobs finish; jobs not started yet stay in Postgres for the next worker. */
export async function stopJobs(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: 20_000 });
}
