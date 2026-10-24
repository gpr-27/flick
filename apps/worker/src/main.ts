import { S3Client } from '@aws-sdk/client-s3';
import { createDb, createPool } from '@chat/db';
import { runChecks } from '@chat/shared';
import { Redis } from 'ioredis';
import { PgBoss } from 'pg-boss';
import { dependencyChecks } from './checks.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { startJobs, stopJobs } from './jobs/boss.js';
import type { UploadStorage } from './jobs/sweep-uploads.js';
import { createLogger } from './logger.js';
import { SimulatedLogNotificationProvider, type NotificationProvider } from './notifications.js';
import { createOpsServer } from './server.js';
import {
  WebPushNotificationProvider,
  createWebPushSender,
  type PushSender,
} from './web-push-provider.js';

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\nSee .env.example.\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool({
  connectionString: config.DATABASE_URL,
  max: config.DATABASE_POOL_MAX,
  application_name: 'chat-worker',
});
const db = createDb(pool);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectionName: 'chat-worker',
});
const checks = dependencyChecks(pool, redis);

let shuttingDown = false;
const server = createOpsServer(checks, () => shuttingDown);
server.listen(config.WORKER_METRICS_PORT);

const startup = await runChecks(checks, 5_000);
for (const check of startup.checks.filter((c) => !c.ok)) {
  logger.fatal({ dependency: check.name }, check.error ?? 'down');
}
if (startup.status !== 'ready') process.exit(1);

// Real Web Push when the VAPID keys are set; otherwise a clearly labelled simulation.
let provider: NotificationProvider;
let pushSender: PushSender | null = null;
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT) {
  const sender = createWebPushSender({
    subject: config.VAPID_SUBJECT,
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
  });
  pushSender = sender;
  provider = new WebPushNotificationProvider(db, sender, logger);
} else {
  logger.warn('VAPID keys not set: notifications are SIMULATED (logged, nothing is sent)');
  provider = new SimulatedLogNotificationProvider(logger);
}

let storage: UploadStorage | undefined;
if (config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
  storage = {
    bucket: config.S3_BUCKET,
    client: new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    }),
  };
}

const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  application_name: 'chat-worker-boss',
});
await startJobs({
  boss,
  db,
  logger,
  notify: { db, redis, provider },
  callPush: { db, redis, sender: pushSender, logger },
  storage,
});
logger.info(
  {
    port: config.WORKER_METRICS_PORT,
    webPush: provider instanceof WebPushNotificationProvider,
    uploadSweep: !!storage,
  },
  'worker started',
);

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 30_000).unref(); // a running job may need time to finish
  await stopJobs(boss);
  server.close();
  await pool.end();
  await redis.quit();
  storage?.client.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
