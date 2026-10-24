import { runChecks } from '@chat/shared';
import { buildApp } from './app.js';
import { dependencyChecks } from './checks.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { createDb } from './db.js';
import { createLogger } from './logger.js';
import { createAiService } from './modules/ai/service.js';
import { createAuth, createClerk, type Auth } from './modules/auth/index.js';
import { createFakeClerk } from './modules/auth/fake-clerk.js';
import { createRedis } from './redis.js';

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
const db = createDb(config.DATABASE_URL, config.DATABASE_POOL_MAX);
const redis = createRedis(config.REDIS_URL);
const checks = dependencyChecks(config, db, redis);

// Fail fast with a message naming the broken dependency. Docker/Kubernetes restart the
// container, which also covers dependencies that are still starting up.
const startup = await runChecks(checks, 5_000);
for (const check of startup.checks.filter((c) => !c.ok)) {
  logger[check.critical ? 'fatal' : 'warn']({ dependency: check.name }, check.error ?? 'down');
}
if (startup.status === 'not_ready') process.exit(1);

let shuttingDown = false;
let auth: Auth;
try {
  // E2E_FAKE_AUTH is for browser and load tests only; loadConfig refuses it in production.
  auth = createAuth({
    db,
    redis,
    clerk: config.E2E_FAKE_AUTH ? createFakeClerk() : createClerk(config),
  });
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`${error.message}\nSee .env.example.\n`);
  process.exit(1);
}
// Shared with the @flick bot, which the outbox dispatcher calls (see modules/ai/bot.ts).
const ai = createAiService({ config, redis, logger });
const app = await buildApp({
  ai,
  config,
  logger,
  db,
  redis,
  checks,
  isShuttingDown: () => shuttingDown,
  authenticate: auth.authenticate,
  authenticateSocket: auth.authenticateSocket,
});
await app.listen({ host: config.API_HOST, port: config.API_PORT });

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true; // /health/ready now returns 503
  logger.info({ signal }, 'shutting down');
  // If something hangs, exit anyway so the orchestrator is not left waiting.
  setTimeout(() => process.exit(1), 10_000).unref();
  await app.close(); // stops accepting, closes WebSockets, waits for in-flight requests
  await db.destroy();
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
