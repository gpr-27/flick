import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { Database } from '@chat/db';
import type { Kysely } from 'kysely';

const BATCH = 200;

/**
 * Removes uploads that were started but never completed: the object (if the client uploaded
 * anything) and then the row. The worker runs this on a schedule.
 * Returns how many were removed.
 */
export async function sweepAbandonedUploads(
  db: Kysely<Database>,
  s3: { client: Pick<S3Client, 'send'>; bucket: string },
  olderThan: Date,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const batch = await db
      .selectFrom('attachments')
      .select(['id', 'object_key'])
      .where('status', '=', 'pending')
      .where('created_at', '<', olderThan)
      .orderBy('created_at')
      .limit(BATCH)
      .execute();
    for (const row of batch) {
      // Deleting a key that does not exist succeeds in S3, so no existence check is needed.
      // The row goes last: if the delete fails the row stays and the next sweep retries.
      await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: row.object_key }));
      await db
        .deleteFrom('attachments')
        .where('id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
      removed += 1;
    }
    if (batch.length < BATCH) return removed;
  }
}
