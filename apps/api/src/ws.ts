import type { Server as HttpServer } from 'node:http';
import { LIMITS } from '@chat/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import { PgBoss } from 'pg-boss';
import { Server } from 'socket.io';
import type { AppDeps } from './app.js';
import { flickBotOnMessage, type FlickTrigger } from './modules/ai/bot.js';
import { attachGateway } from './modules/gateway/index.js';
import { createDispatcher, NOTIFY_QUEUE } from './modules/dispatcher/index.js';
import type { Redis } from './redis.js';

// The adapter's subscriber connection, kept so closeIo can end it (the adapter leaves it open).
const subscribers = new WeakMap<Server, Redis>();

/** Socket.IO on an HTTP server. The Redis adapter makes a room emit reach every API replica. */
export function createIo(httpServer: HttpServer, redis: Redis, origins: string[]): Server {
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
  if (!authenticateSocket) return;

  const stops: (() => Promise<unknown> | void)[] = [];
  // Fastify waits for open connections before it runs onClose, and a Socket.IO connection stays
  // open until someone closes it. So the sockets are disconnected first (clients reconnect to
  // another replica); without this a shutdown with connected users would hang.
  app.addHook('preClose', () => {
    io?.disconnectSockets(true);
  });
  app.addHook('onReady', async () => {
    const server = createIo(app.server, deps.redis, deps.config.CORS_ORIGINS);
    io = server;
    const gateway = attachGateway(server, { ...deps, authenticateSocket });

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

    // The @flick bot runs after delivery and is not awaited: a slow AI call never delays messages.
    const { ai } = deps;
    const onMessageCreated = ai
      ? (message: FlickTrigger) =>
          void flickBotOnMessage(
            { db: deps.db, redis: deps.redis, logger: deps.logger, ai },
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
