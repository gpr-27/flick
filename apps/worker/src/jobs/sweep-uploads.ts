import type { S3Client } from '@aws-sdk/client-s3';
import type { Database } from '@chat/db';
import { sweepAbandonedUploads } from '@chat/uploads';
import type { Kysely } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';
import { uploadsSweptTotal } from '../metrics.js';

export const SWEEP_UPLOADS_QUEUE = 'sweep-uploads';

// A presigned upload lasts minutes, so a day is far past any real upload still in progress.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface UploadStorage {
  client: S3Client;
  bucket: string;
}

export async function sweepUploads(db: Kysely<Database>, s3: UploadStorage, now = new Date()) {
  const removed = await sweepAbandonedUploads(db, s3, new Date(now.getTime() - MAX_AGE_MS));
  uploadsSweptTotal.inc(removed);
  return removed;
}

export async function registerSweepUploads(
  boss: PgBoss,
  db: Kysely<Database>,
  s3: UploadStorage,
  logger: Logger,
): Promise<void> {
  await boss.work(SWEEP_UPLOADS_QUEUE, async () => {
    logger.info({ removed: await sweepUploads(db, s3) }, 'sweep-uploads finished');
  });
  await boss.schedule(SWEEP_UPLOADS_QUEUE, '17 * * * *'); // hourly, off the hour mark
}
