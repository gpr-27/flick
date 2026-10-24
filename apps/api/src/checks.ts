import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { DependencyCheck } from '@chat/shared';
import { sql } from 'kysely';
import { s3Config, type Config } from './config.js';
import type { Db } from './db.js';
import type { Redis } from './redis.js';

/**
 * What /health/ready checks for the API.
 * - Postgres and Redis are critical: no auth, no messages without them.
 * - Object storage only affects media, so it is not critical.
 */
export function dependencyChecks(config: Config, db: Db, redis: Redis): DependencyCheck[] {
  const checks: DependencyCheck[] = [
    {
      name: 'postgres',
      critical: true,
      check: async () => {
        await sql`select 1`.execute(db).catch((error: unknown) => {
          throw new Error(
            `cannot query Postgres (check DATABASE_URL): ${(error as Error).message}`,
          );
        });
      },
    },
    {
      name: 'redis',
      critical: true,
      check: async () => {
        await redis.ping().catch((error: unknown) => {
          throw new Error(`cannot reach Redis (check REDIS_URL): ${(error as Error).message}`);
        });
      },
    },
  ];

  const s3 = s3Config(config);
  if (s3) {
    const client = new S3Client({ ...s3, forcePathStyle: true, maxAttempts: 1 });
    checks.push({
      name: 'object-storage',
      critical: false,
      check: async () => {
        await client.send(new HeadBucketCommand({ Bucket: s3.bucket })).catch((error: unknown) => {
          throw new Error(
            `cannot access bucket "${s3.bucket}" (check S3_ENDPOINT, S3_BUCKET and keys): ${(error as Error).name}`,
          );
        });
      },
    });
  }
  return checks;
}
