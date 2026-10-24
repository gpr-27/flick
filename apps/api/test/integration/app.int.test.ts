import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { runChecks } from '@chat/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { dependencyChecks } from '../../src/checks.js';
import { loadConfig, s3Config } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createRedis } from '../../src/redis.js';

// Needs real Postgres, Redis and MinIO, configured with the API's own env vars
// (DATABASE_URL, REDIS_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).
const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const db = createDb(config.DATABASE_URL, 2);
const redis = createRedis(config.REDIS_URL);
const logger = createLogger('silent');

beforeAll(async () => {
  const s3 = s3Config(config);
  if (!s3)
    throw new Error('integration tests need S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
  const client = new S3Client({ ...s3, forcePathStyle: true });
  // The app's storage user may only list/read/write inside the bucket (see infra/minio/init-bucket.sh),
  // so create the bucket only when it is really missing (plain MinIO without the init job).
  await client.send(new HeadBucketCommand({ Bucket: s3.bucket })).catch(async (error: unknown) => {
    if ((error as Error).name !== 'NotFound') throw error;
    await client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
  });
});

afterAll(async () => {
  await db.destroy();
  await redis.quit();
});

describe('API against real services', () => {
  it('reports postgres, redis and object storage as ready', async () => {
    const report = await runChecks(dependencyChecks(config, db, redis));
    expect(report).toEqual({
      status: 'ready',
      checks: [
        { name: 'postgres', critical: true, ok: true },
        { name: 'redis', critical: true, ok: true },
        { name: 'object-storage', critical: false, ok: true },
      ],
    });
  });

  it('names the variable to fix when Postgres is unreachable', async () => {
    const badDb = createDb('postgres://chat:chat@127.0.0.1:1/chat', 1);
    const report = await runChecks(dependencyChecks(config, badDb, redis));
    await badDb.destroy();
    expect(report.status).toBe('not_ready');
    expect(report.checks[0]?.error).toContain('check DATABASE_URL');
  });

  it('shares rate-limit counters across API instances through Redis', async () => {
    const limited = { ...config, RATE_LIMIT_MAX: 2 };
    const deps = { config: limited, logger, db, redis, checks: [], isShuttingDown: () => false };
    const [a, b] = await Promise.all([buildApp(deps), buildApp(deps)]);
    // A random client address so counters from earlier runs cannot interfere.
    const remoteAddress = `10.0.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}`;
    const hit = async (app: typeof a) =>
      (await app.inject({ url: '/nothing-here', remoteAddress })).statusCode;
    expect([await hit(a), await hit(b), await hit(a), await hit(b)]).toEqual([404, 404, 429, 429]);
    await Promise.all([a.close(), b.close()]);
  });
});
