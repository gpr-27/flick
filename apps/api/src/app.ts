import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { DependencyCheck } from '@chat/shared';
import Fastify from 'fastify';
import { type AuthContext, type Authenticate, rejectAll } from './auth-guard.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Logger } from './logger.js';
import { httpRequestDuration, rateLimitRejections, registry } from './metrics.js';
import { modules } from './modules/index.js';
import type { AiService } from './modules/ai/service.js';
import type { Redis } from './redis.js';
import { registerRealtime } from './ws.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  db: Db;
  redis: Redis;
  checks: DependencyCheck[];
  isShuttingDown: () => boolean;
  /** Checks the access token on protected routes. Defaults to rejecting everyone. */
  authenticate?: Authenticate;
  /**
   * Checks the Clerk session token sent in the Socket.IO handshake; null means "not allowed".
   * Without it the real-time gateway and the outbox dispatcher are not started.
   */
  authenticateSocket?: (token: string, deviceId: string) => Promise<AuthContext | null>;
  /** The AI chain. Built from the config when not given (tests pass one with fake providers). */
  ai?: AiService;
}

/** Builds the app without listening, so tests can call app.inject() and main.ts owns startup. */
export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: deps.logger,
    trustProxy: config.TRUST_PROXY,
  });

  await app.register(helmet);
  // The web app lives on another origin (Vercel), so every method it uses must be listed:
  // the plugin's default allows only GET, HEAD and POST, which would block PATCH and DELETE.
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // Counters live in Redis so the limit holds across API replicas. If Redis is down the
  // limiter lets requests through (skipOnError) rather than failing every request.
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: 60_000,
    redis: deps.redis,
    skipOnError: true,
    keyGenerator: (req) => req.ip || 'unknown', // injected test connections have no address
    allowList: (req) => req.url.startsWith('/health/') || req.url === '/metrics',
    onExceeded: () => rateLimitRejections.inc({ scope: 'http_global' }),
  });

  // Label with the route template ("GET /users/:id"), not the URL, to keep labels bounded.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ? `${req.method} ${req.routeOptions.url}` : 'unmatched';
    httpRequestDuration.observe({ route, status: reply.statusCode }, reply.elapsedTime / 1000);
  });

  app.get('/metrics', async (_req, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );

  app.setErrorHandler((error: { statusCode?: number; message: string }, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    // Never send internal details (SQL, stack traces) to clients.
    const message = status >= 500 ? 'Internal server error' : error.message;
    return reply.code(status).send({ error: { message, requestId: req.id } });
  });

  // Unknown URLs count against the rate limit too, so URL scanning gets throttled.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) =>
    reply.code(404).send({ error: { message: 'Not found', requestId: req.id } }),
  );

  app.decorate('authenticate', deps.authenticate ?? rejectAll);

  registerRealtime(app, deps);
  for (const register of modules) register(app, deps);
  return app;
}
