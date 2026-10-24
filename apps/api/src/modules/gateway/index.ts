// The Socket.IO gateway: handshake auth, rooms, request/response events, presence, typing, calls.
// Socket.IO already provides reconnects, heartbeats, acks and rooms; this file only adds the rules.
//
// Rooms: user:<userId> (every device of a user), device:<deviceId> (one device),
// presence:<userId> (sockets watching that user's presence).
import {
  CLIENT_PAYLOADS,
  TYPING,
  makeError,
  type Ack,
  type ErrorBody,
  type PresenceUpdatePayload,
} from '@chat/contracts';
import type { Server } from 'socket.io';
import type { z } from 'zod';
import type { AuthContext } from '../../auth-guard.js';
import type { Db } from '../../db.js';
import type { Logger } from '../../logger.js';
import { rateLimitRejections, wsConnectAttempts, wsConnectionsActive } from '../../metrics.js';
import type { Redis } from '../../redis.js';
import {
  acknowledgeDelivered,
  acknowledgeRead,
  sendMessage,
  syncMany,
  toApiError,
} from '../messages/index.js';
import type { CallPushJob } from './call-push.js';
import { createCalls, type CallEventName, type Calls } from './calls.js';
import { createPresence, PRESENCE_TTL_MS } from './presence.js';
import { TokenBucket } from './rate-limit.js';
import { createGatewayRepo } from './repo.js';

export interface GatewayDeps {
  db: Db;
  redis: Redis;
  logger: Logger;
  authenticateSocket: (token: string, deviceId: string) => Promise<AuthContext | null>;
  /** Queues a Web Push for a call (see call-push.ts). Without it, offline users cannot be rung. */
  enqueueCallPush?: (job: CallPushJob) => Promise<void>;
  /** How long a call waits for an offline callee (default 45 s); tests make it short. */
  parkedTtlMs?: number;
}

const CALL_EVENTS: CallEventName[] = [
  'call_offer',
  'call_answer',
  'call_ice',
  'call_end',
  'call_reject',
  'call_busy',
  'call_renegotiate',
];

/** The auth context the handshake middleware stored on the socket. */
const authOf = (socket: { data: unknown }) => (socket.data as { auth: AuthContext }).auth;

export function attachGateway(
  io: Server,
  deps: GatewayDeps,
): { close(): Promise<void>; calls: Calls } {
  const { db, redis, logger } = deps;
  const repo = createGatewayRepo(db);
  const presence = createPresence(redis);
  const calls = createCalls({
    io,
    db,
    redis,
    repo,
    presence,
    logger,
    enqueueCallPush: deps.enqueueCallPush,
    parkedTtlMs: deps.parkedTtlMs,
  });
  const messageDeps = { db };

  // The Clerk session token is in the handshake `auth` object, never in the URL.
  io.use((socket, next) => {
    const { token, deviceId } = socket.handshake.auth as Record<string, unknown>;
    if (typeof token !== 'string' || typeof deviceId !== 'string') {
      wsConnectAttempts.inc({ result: 'bad_auth' });
      return next(new Error('unauthorized'));
    }
    deps
      .authenticateSocket(token, deviceId)
      .catch(() => null)
      .then((auth) => {
        if (!auth) {
          wsConnectAttempts.inc({ result: 'bad_auth' });
          return next(new Error('unauthorized'));
        }
        (socket.data as { auth: AuthContext }).auth = auth;
        wsConnectAttempts.inc({ result: 'ok' });
        next();
      }, next);
  });

  async function presenceOf(userIds: string[]): Promise<z.infer<typeof PresenceUpdatePayload>[]> {
    const lastSeen = await repo.visibleLastSeen(userIds);
    return Promise.all(
      userIds.map(async (id) => {
        const online = await presence.isOnline(id);
        return { user_id: id, online, last_seen_at: online ? null : (lastSeen.get(id) ?? null) };
      }),
    );
  }
  async function announce(userId: string): Promise<void> {
    const [update] = await presenceOf([userId]);
    io.to(`presence:${userId}`).emit('presence_update', update!);
  }

  // Cleanup of sockets that just left. close() waits for it, so Redis is not closed under it.
  const disconnecting = new Set<Promise<unknown>>();

  io.on('connection', (socket) => {
    const ctx = authOf(socket);
    void socket.join([`user:${ctx.userId}`, `device:${ctx.deviceId}`]);
    wsConnectionsActive.inc();
    const online = presence
      .add(ctx.userId, socket.id)
      .then(async (cameOnline) => {
        if (cameOnline) await announce(ctx.userId);
      })
      .catch((error: unknown) => logger.warn({ error }, 'presence add failed'));
    // A call that rang this person's push notification while they were away is handed over now, and
    // once more after their first sync (by then the app has certainly bound its call handlers).
    const deliverParked = () =>
      calls
        .deliverParked(socket, ctx.userId)
        .catch((error: unknown) => logger.warn({ error }, 'delivering a parked call failed'));
    void online.then(deliverParked);
    let deliveredAfterSync = false;

    const bucket = new TokenBucket(40, 20); // per socket, in memory
    const lastSent = new Map<string, number>();
    const throttled = (key: string): boolean => {
      const now = Date.now();
      if (now - (lastSent.get(key) ?? 0) < TYPING.THROTTLE_MS) return true;
      lastSent.set(key, now);
      return false;
    };

    // Validates the payload, applies the rate limit, runs the handler and answers the ack.
    function on<E extends keyof typeof CLIENT_PAYLOADS>(
      event: E,
      run: (data: z.output<(typeof CLIENT_PAYLOADS)[E]>) => Promise<unknown>,
    ): void {
      const name: string = event;
      socket.on(name, async (raw: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack<unknown>) => void) : undefined;
        const fail = (error: ErrorBody) => reply?.({ ok: false, error });
        if (!bucket.take()) {
          rateLimitRejections.inc({ scope: 'ws' });
          return fail(makeError('RATE_LIMITED', 'Too many events, slow down.'));
        }
        const parsed = CLIENT_PAYLOADS[event].safeParse(raw);
        if (!parsed.success) {
          const issues = parsed.error.issues.slice(0, 10).map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          }));
          return fail(makeError('VALIDATION_FAILED', `invalid ${event}`, { issues }));
        }
        try {
          const data = (await run(parsed.data as never)) ?? null; // run first: reply?.() skips its arguments
          reply?.({ ok: true, data });
        } catch (error) {
          const apiError = toApiError(error);
          if (apiError.code === 'INTERNAL') logger.error({ err: apiError.cause, event }, 'failed');
          fail(apiError.toBody());
        }
      });
    }

    on('send_message', (d) => sendMessage(messageDeps, ctx, d));
    on('delivery_ack', (d) =>
      acknowledgeDelivered(
        messageDeps,
        ctx,
        d.acks.map((a) => ({ conversationId: a.conversation_id, seq: a.seq })),
      ),
    );
    on('read_ack', async (d) => {
      await acknowledgeRead(messageDeps, ctx, { conversationId: d.conversation_id, seq: d.seq });
    });
    on('sync_request', async (d) => {
      const result = await syncMany(messageDeps, ctx, d);
      if (!deliveredAfterSync) {
        deliveredAfterSync = true;
        void deliverParked();
      }
      return result;
    });

    // Typing and recording are never stored: relayed to the other members and forgotten.
    async function relayToMembers(
      event: 'typing_start' | 'typing_stop' | 'activity',
      d: { conversation_id: string },
    ): Promise<void> {
      const members = await repo.activeMemberIds(d.conversation_id);
      if (!members.includes(ctx.userId)) return; // members only
      io.to(members.map((id) => `user:${id}`))
        .except(`user:${ctx.userId}`)
        .emit(event as never, { ...d, user_id: ctx.userId });
    }
    on('typing_start', async (d) => {
      if (!throttled(`typing:${d.conversation_id}`)) await relayToMembers('typing_start', d);
    });
    on('typing_stop', (d) => relayToMembers('typing_stop', d));
    on('activity', async (d) => {
      if (d.state === 'start' && throttled(`${d.activity}:${d.conversation_id}`)) return;
      await relayToMembers('activity', d);
    });

    // Replaces the watch list; only users who share a conversation with the caller are allowed.
    on('presence_subscribe', async (d) => {
      const allowed = await repo.usersSharingConversation(ctx.userId, d.user_ids);
      const wanted = new Set(allowed.map((id) => `presence:${id}`));
      for (const room of socket.rooms) {
        if (room.startsWith('presence:') && !wanted.has(room)) void socket.leave(room);
      }
      await socket.join([...wanted]);
      return presenceOf(allowed);
    });

    for (const event of CALL_EVENTS) on(event, (d) => calls.handle(socket, ctx, event, d));

    socket.on('disconnect', () => {
      wsConnectionsActive.dec();
      const work = (async () => {
        await online;
        if (await presence.remove(ctx.userId, socket.id)) {
          await repo.touchLastSeen(ctx.userId); // last seen is stored when the last device leaves
          await announce(ctx.userId);
          await calls.onUserOffline(ctx.userId);
        }
      })().catch((error: unknown) => logger.warn({ error }, 'presence remove failed'));
      disconnecting.add(work);
      void work.finally(() => disconnecting.delete(work));
    });
  });

  // Live entries must not expire while their socket is open.
  const refresh = setInterval(() => {
    const sockets = [...io.sockets.sockets.values()].map((s) => ({
      userId: authOf(s).userId,
      socketId: s.id,
    }));
    presence.refresh(sockets).catch((error: unknown) => logger.warn({ error }, 'presence refresh'));
  }, PRESENCE_TTL_MS / 3);
  refresh.unref();

  return {
    calls,
    async close() {
      clearInterval(refresh);
      calls.close();
      await Promise.allSettled([...disconnecting]);
    },
  };
}
