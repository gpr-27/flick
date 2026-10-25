import type { Server as HttpServer } from 'node:http';
import { ENDPOINTS, LIMITS } from '@chat/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import { PgBoss } from 'pg-boss';
import { Server } from 'socket.io';
import type { AppDeps } from './app.js';
import { flickBotOnMessage, type FlickTrigger } from './modules/ai/bot.js';
import { CALL_PUSH_QUEUE, type CallPushJob } from './modules/gateway/call-push.js';
import { attachGateway } from './modules/gateway/index.js';
import { createDispatcher, NOTIFY_QUEUE } from './modules/dispatcher/index.js';
import type { Redis } from './redis.js';

// The adapter's subscriber connection, kept so closeIo can end it (the adapter leaves it open).
const subscribers = new WeakMap<Server, Redis>();

const patched = new WeakSet<Redis>();

/**
 * The Redis adapter calls `publish()` on every emit and neither awaits nor catches it. While Redis
 * is down that promise rejects with nobody listening, and Node ends the process for an unhandled
 * rejection: one broadcast would take the whole API down (ADR-0005 says Redis down must not do
 * that). Marking the promise as handled keeps the failure where it belongs: callers that await it
 * (the adapter's own requests, such as fetchSockets) still see the error, and the dispatcher's
 * retry logic handles it. Emits still reach this server's own sockets.
 */
function publishNeverCrashes(redis: Redis): void {
  if (patched.has(redis)) return;
  patched.add(redis);
  const publish = redis.publish.bind(redis) as (...args: unknown[]) => Promise<number>;
  redis.publish = (...args: unknown[]) => {
    const result = publish(...args);
    result.catch(() => undefined);
    return result;
  };
}

/** Socket.IO on an HTTP server. The Redis adapter makes a room emit reach every API replica. */
export function createIo(httpServer: HttpServer, redis: Redis, origins: string[]): Server {
  publishNeverCrashes(redis);
  const io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: LIMITS.MAX_FRAME_BYTES,
  });
  const subscriber = redis.duplicate();
  subscribers.set(io, subscriber);
  io.adapter(createAdapter(redis, subscriber));
  return io;
}

/**
 * Closes the server, then the adapter's subscriber connection. QUIT is queued behind the adapter's
 * own unsubscribe commands, so they finish instead of failing with "Connection is closed".
 */
export async function closeIo(io: Server): Promise<void> {
  await io.close();
  await subscribers
    .get(io)
    ?.quit()
    .catch(() => undefined);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Closes every socket in these rooms (`device:<id>`, `user:<id>`), on every API replica. */
    disconnectRooms: (rooms: string[]) => void;
  }
}

/** Starts the real-time gateway and the outbox dispatcher with the app, and stops them with it. */
export function registerRealtime(app: FastifyInstance, deps: AppDeps): void {
  let io: Server | undefined;
  // Always available (a no-op while the gateway is off, as in most tests). The Redis adapter
  // carries the order to the other replicas.
  app.decorate('disconnectRooms', (rooms: string[]) => {
    io?.in(rooms).disconnectSockets(true);
  });

  const { authenticateSocket } = deps;
  const stops: (() => Promise<unknown> | void)[] = [];
  let declineFromPush: ((callId: string, token: string) => Promise<boolean>) | undefined;

  // "Decline" on a call notification while Flick is closed. The service worker has no login; the
  // one-time token from inside the push is the proof (it expires with the ringing window).
  app.post(
    ENDPOINTS.calls.declineFromPush.path,
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (req, reply) => {
      const body = ENDPOINTS.calls.declineFromPush.body.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: { message: 'Invalid request' } });
      if (!declineFromPush) return reply.code(503).send({ error: { message: 'Not ready' } });
      const ok = await declineFromPush(body.data.call_id, body.data.token);
      if (!ok) return reply.code(404).send({ error: { message: 'No such call' } });
      return reply.code(204).send();
    },
  );
  // Without a socket login there is no gateway, and so no calls to decline (the route answers 503).
  if (!authenticateSocket) return;

  // Fastify waits for open connections before it runs onClose, and a Socket.IO connection stays
  // open until someone closes it. So the sockets are disconnected first (clients reconnect to
  // another replica); without this a shutdown with connected users would hang.
  app.addHook('preClose', () => {
    io?.disconnectSockets(true);
  });
  app.addHook('onReady', async () => {
    const server = createIo(app.server, deps.redis, deps.config.CORS_ORIGINS);
    io = server;
    // pg-boss only sends here (the worker runs the jobs), so its own scheduling is switched off.
    const boss = new PgBoss({
      connectionString: deps.config.DATABASE_URL,
      max: 2,
      supervise: false,
      schedule: false,
    });
    // Without a listener an 'error' event (for example Postgres restarting) would crash the process.
    boss.on('error', (error) => deps.logger.error({ err: error }, 'pg-boss error'));
    await boss.start();
    await boss.createQueue(NOTIFY_QUEUE, { retryLimit: 5, retryDelay: 10, retryBackoff: true });
    // A ring push is only useful for a few seconds, so it is retried quickly and not for long.
    await boss.createQueue(CALL_PUSH_QUEUE, { retryLimit: 2, retryDelay: 2 });

    const gateway = attachGateway(server, {
      ...deps,
      authenticateSocket,
      enqueueCallPush: async (job: CallPushJob) => {
        await boss.send(CALL_PUSH_QUEUE, job);
      },
    });
    declineFromPush = (callId, token) => gateway.calls.declineFromPush(callId, token);

    // The @flick bot runs after delivery and is not awaited: a slow AI call never delays messages.
    const { ai } = deps;
    const onMessageCreated = ai
      ? (message: FlickTrigger) =>
          void flickBotOnMessage(
            {
              db: deps.db,
              redis: deps.redis,
              logger: deps.logger,
              ai,
              config: deps.config,
              checks: deps.checks,
            },
            message,
          ).catch((error: unknown) => deps.logger.warn({ error }, 'flick bot failed'))
      : undefined;
    const dispatcher = createDispatcher({ ...deps, io: server, boss, onMessageCreated });
    dispatcher.start();
    stops.push(
      () => dispatcher.stop(),
      () => boss.stop({ graceful: false }),
      () => gateway.close(),
      () => closeIo(server),
    );
  });
  app.addHook('onClose', async () => {
    for (const stop of stops.splice(0)) await stop();
  });
}
