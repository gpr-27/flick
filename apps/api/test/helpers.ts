import type { DependencyCheck } from '@chat/shared';
import { afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { Redis } from '../src/redis.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://chat:chat@127.0.0.1:1/chat',
  REDIS_URL: 'redis://127.0.0.1:1',
};

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/**
 * An app for HTTP-level tests, with no real services behind it: the pg pool never connects
 * (no query is run) and the Redis client fails every command at once, so the rate limiter
 * lets requests through. Readiness checks are passed in by each test.
 */
export async function testApp(checks: DependencyCheck[] = [], shuttingDown = false) {
  const config = loadConfig(TEST_ENV);
  const app = await buildApp({
    config,
    logger: createLogger('silent'),
    db: createDb(config.DATABASE_URL, 1),
    redis: new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false }),
    checks,
    isShuttingDown: () => shuttingDown,
  });
  apps.push(app);
  await app.ready();
  return app;
}
