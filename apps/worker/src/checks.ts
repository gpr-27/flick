import type { DependencyCheck } from '@chat/shared';
import type { Redis } from 'ioredis';
import type pg from 'pg';

/** The worker needs Postgres (jobs and data) and Redis (the "is this user online" check). */
export function dependencyChecks(pool: pg.Pool, redis: Redis): DependencyCheck[] {
  return [
    {
      name: 'postgres',
      critical: true,
      check: async () => {
        await pool.query('select 1').catch((error: unknown) => {
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
}
