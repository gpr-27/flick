// 1:1 call signaling. The server only relays SDP and ICE; media is peer to peer.
//
// Safety rule: after an offer pairs two users, every other call event is relayed only to the
// peer of the sender's active call with the same call_id. The client never says who to send to.
// Call state is in Redis so it works across API replicas.
//
// A callee with no connected device is not given up on at once: if they have a push subscription
// the offer is "parked" in Redis for a short while and a Web Push is queued (parked-calls.ts,
// docs/features/calls-offline.md). If their app connects inside the window, the offer is handed
// over right after the handshake; if not, the call is logged as missed and the push is taken back.
import { randomBytes } from 'node:crypto';
import type { Server } from 'socket.io';
import type { AuthContext } from '../../auth-guard.js';
import type { Db } from '../../db.js';
import type { Logger } from '../../logger.js';
import type { Redis } from '../../redis.js';
import { recordCall, type RecordCallInput } from '../calls/index.js';
import type { CallPushJob } from './call-push.js';
import { createParkedCalls } from './parked-calls.js';
import type { Presence } from './presence.js';
import type { GatewayRepo } from './repo.js';

interface CallPayload {
  call_id: string;
  conversation_id?: string;
  media?: 'audio' | 'video';
}
export type CallEventName =
  | 'call_offer'
  | 'call_answer'
  | 'call_ice'
  | 'call_end'
  | 'call_reject'
  | 'call_busy'
  | 'call_renegotiate';

// What one user remembers about their current call.
interface CallState {
  callId: string;
  peerId: string;
  role: 'caller' | 'callee';
  /** The device this user's side uses (the callee has none until one answers). */
  deviceId: string | null;
  /** The peer's device once known; before that signals go to all of the peer's devices. */
  peerDeviceId: string | null;
  /** What the call log needs when the call ends. Both users' states hold the same values. */
  conversationId: string;
  callerId: string;
  media: 'audio' | 'video';
  startedAt: number;
  answeredAt: number | null;
  /** The callee was offline: the offer is parked and a push was queued. */
  parked?: boolean;
  /** Kept for the cancel push, so ending a call needs no database lookup. */
  callerName?: string;
}

const CALL_TTL_SECONDS = 6 * 60 * 60; // a safety net if a server dies mid-call
const RECONNECT_GRACE_MS = 10_000;
/** A parked call's state outlives its offer a little, then Redis removes it by itself. */
const PARKED_STATE_EXTRA_MS = 15_000;
const callKey = (userId: string) => `call:user:${userId}`;

export function createCalls(deps: {
  io: Server;
  db: Db;
  redis: Redis;
  repo: GatewayRepo;
  presence: Presence;
  logger: Logger;
  graceMs?: number;
  /** Queues a push for the worker. Without it, nobody offline can be rung. */
  enqueueCallPush?: (job: CallPushJob) => Promise<void>;
  /** How long a call waits for an offline callee; tests make it short. */
  parkedTtlMs?: number;
}) {
  const { io, redis, repo, presence } = deps;
  const graceMs = deps.graceMs ?? RECONNECT_GRACE_MS;
  const timers = new Set<NodeJS.Timeout>();
  const parked = createParkedCalls(redis, deps.parkedTtlMs);

  const getState = async (userId: string): Promise<CallState | null> => {
    const raw = await redis.get(callKey(userId));
    return raw ? (JSON.parse(raw) as CallState) : null;
  };
  const setState = (userId: string, state: CallState, ttlMs = CALL_TTL_SECONDS * 1000) =>
    redis.set(callKey(userId), JSON.stringify(state), 'PX', ttlMs);
  async function clearCall(userId: string, peerId: string, callId: string): Promise<void> {
    for (const id of [userId, peerId]) {
      if ((await getState(id))?.callId === callId) await redis.del(callKey(id));
    }
  }

  // Writes the call log row and the chat message. recordCall ignores a repeated call_id, so a
  // double hang-up still logs the call once. A logging failure must not break signaling.
  async function logCall(state: CallState, outcome: RecordCallInput['outcome']): Promise<void> {
    await recordCall(deps.db, {
      callId: state.callId,
      conversationId: state.conversationId,
      callerId: state.callerId,
      media: state.media,
      outcome,
      startedAt: new Date(state.startedAt),
      answeredAt: state.answeredAt ? new Date(state.answeredAt) : null,
      endedAt: new Date(),
    }).catch((error: unknown) => deps.logger.error({ error }, 'recording the call failed'));
  }
  // Answered means completed; hung up or timed out before that means missed; refused means rejected.
  const outcomeOf = (state: CallState, rejected: boolean): RecordCallInput['outcome'] =>
    state.answeredAt ? 'completed' : rejected ? 'rejected' : 'missed';

  const send = (room: string, event: string, payload: object, from: string) =>
    void io.to(room).emit(event as never, { ...payload, from_user_id: from });

  const queuePush = (job: CallPushJob): void => {
    deps
      .enqueueCallPush?.(job)
      .catch((error: unknown) =>
        deps.logger.warn({ error, callId: job.call_id }, 'queueing the call push failed'),
      );
  };

  // The parked offer is not needed any more. If the caller gave up before anyone answered, the
  // "calling" notification is taken back (the browser turns it into "Missed call").
  async function dropParked(userId: string, state: CallState): Promise<void> {
    if (!state.parked) return;
    const calleeId = state.role === 'callee' ? userId : state.peerId;
    await parked.clear(calleeId, state.callId);
    if (state.role === 'caller' && !state.answeredAt) {
      queuePush({
        kind: 'cancel',
        user_id: calleeId,
        call_id: state.callId,
        conversation_id: state.conversationId,
        caller_name: state.callerName ?? 'Someone',
        media: state.media,
      });
    }
  }

  // The window passed and nobody answered: tell both sides, take the push back, log a missed call.
  // Decided from the callee's state, so a call that was answered, declined or cancelled is left alone.
  async function expireParked(calleeId: string, callId: string): Promise<void> {
    const callee = await getState(calleeId);
    if (callee?.callId !== callId || callee.role !== 'callee') return;
    if (callee.deviceId || callee.answeredAt) return;
    const gone = { call_id: callId, reason: 'timeout' };
    send(`user:${callee.peerId}`, 'call_end', gone, calleeId);
    send(`user:${calleeId}`, 'call_end', gone, callee.peerId);
    await clearCall(calleeId, callee.peerId, callId);
    await dropParked(callee.peerId, { ...callee, role: 'caller', peerId: calleeId });
    await logCall(callee, 'missed');
  }

  function scheduleExpiry(calleeId: string, callId: string): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      expireParked(calleeId, callId).catch((error: unknown) =>
        deps.logger.warn({ error }, 'expiring a parked call failed'),
      );
    }, parked.ttlMs + 250);
    timer.unref();
    timers.add(timer);
  }

  async function offer(
    socket: { id: string; emit: (e: string, p: object) => unknown },
    ctx: AuthContext,
    p: CallPayload & { sdp?: { type: 'offer' | 'answer'; sdp: string } },
  ): Promise<void> {
    const callId = p.call_id;
    const unavailable = (reason: 'blocked' | 'offline' | 'unreachable') =>
      socket.emit('call_unavailable', { call_id: callId, reason });

    const peerId = await repo.directPeer(p.conversation_id!, ctx.userId);
    if (!peerId) return; // not a direct conversation of this user
    if (await repo.isBlockedEitherWay(ctx.userId, peerId)) return void unavailable('blocked');

    // Offline: ring them with a push if they have one; otherwise there is no way to reach them.
    const online = await presence.isOnline(peerId);
    if (!online) {
      if (!deps.enqueueCallPush) return void unavailable('offline');
      if (!(await repo.hasPushSubscription(peerId))) return void unavailable('unreachable');
    }

    // Either side on a different call means busy; never overwrite a live pairing.
    const [theirs, mine] = await Promise.all([getState(peerId), getState(ctx.userId)]);
    if ((theirs && theirs.callId !== callId) || (mine && mine.callId !== callId)) {
      socket.emit('call_busy', { call_id: callId, from_user_id: peerId });
      return;
    }
    const callerName = online ? undefined : await repo.displayName(ctx.userId);
    const shared = {
      callId,
      conversationId: p.conversation_id!,
      callerId: ctx.userId,
      media: p.media ?? 'audio',
      startedAt: Date.now(),
      answeredAt: null,
      ...(online ? {} : { parked: true, callerName }),
    };
    // A parked call's state is short-lived: it must not block the callee for hours if this server
    // dies before the window ends. Answering renews it.
    const ttl = online ? undefined : parked.ttlMs + PARKED_STATE_EXTRA_MS;
    await Promise.all([
      setState(
        ctx.userId,
        { ...shared, peerId, role: 'caller', deviceId: ctx.deviceId, peerDeviceId: null },
        ttl,
      ),
      setState(
        peerId,
        {
          ...shared,
          peerId: ctx.userId,
          role: 'callee',
          deviceId: null,
          peerDeviceId: ctx.deviceId,
        },
        ttl,
      ),
    ]);

    if (online) return void send(`user:${peerId}`, 'call_offer', p, ctx.userId);

    const declineToken = randomBytes(24).toString('hex');
    await parked.park(
      peerId,
      {
        call_id: callId,
        conversation_id: p.conversation_id!,
        media: shared.media,
        sdp: p.sdp!,
        from_user_id: ctx.userId,
      },
      declineToken,
    );
    scheduleExpiry(peerId, callId);
    queuePush({
      kind: 'ring',
      user_id: peerId,
      call_id: callId,
      conversation_id: p.conversation_id!,
      caller_name: callerName!,
      media: shared.media,
      decline_token: declineToken,
    });
  }

  async function signal(
    ctx: AuthContext,
    event: CallEventName,
    p: CallPayload & { candidate?: object | null },
  ): Promise<void> {
    const mine = await getState(ctx.userId);
    if (mine?.callId !== p.call_id) return; // not our call
    if (mine.deviceId && mine.deviceId !== ctx.deviceId) return; // another device of ours has it

    const peerRoom = mine.peerDeviceId ? `device:${mine.peerDeviceId}` : `user:${mine.peerId}`;
    const relay = () => send(peerRoom, event, p, ctx.userId);
    // The user's other devices were ringing too: tell them the call is handled elsewhere.
    const stopOtherDevices = () =>
      void io.to(`user:${ctx.userId}`).except(`device:${ctx.deviceId}`).emit('call_end', {
        call_id: p.call_id,
        reason: 'answered_elsewhere',
        from_user_id: mine.peerId,
      });

    switch (event) {
      case 'call_answer': {
        if (mine.role !== 'callee' || mine.deviceId) return; // only the callee, only once
        const answeredAt = Date.now();
        await setState(ctx.userId, { ...mine, deviceId: ctx.deviceId, answeredAt });
        const theirs = await getState(mine.peerId);
        if (theirs)
          await setState(mine.peerId, { ...theirs, peerDeviceId: ctx.deviceId, answeredAt });
        if (mine.peerDeviceId) send(`device:${mine.peerDeviceId}`, event, p, ctx.userId);
        await dropParked(ctx.userId, mine);
        return stopOtherDevices();
      }
      case 'call_reject':
      case 'call_busy':
      case 'call_end':
        relay();
        await clearCall(ctx.userId, mine.peerId, p.call_id);
        await dropParked(ctx.userId, mine);
        await logCall(mine, outcomeOf(mine, event !== 'call_end'));
        if (!mine.deviceId) stopOtherDevices(); // we were still ringing
        return;
      case 'call_ice':
        relay();
        // The callee is not here yet: keep the caller's candidates for when they arrive.
        if (mine.parked && mine.role === 'caller' && !mine.answeredAt)
          await parked.addIce(mine.peerId, {
            call_id: p.call_id,
            candidate: p.candidate ?? null,
            from_user_id: ctx.userId,
          });
        return;
      default: // call_renegotiate
        relay();
    }
  }

  return {
    async handle(
      socket: { id: string; emit: (e: string, p: object) => unknown },
      ctx: AuthContext,
      event: CallEventName,
      payload: CallPayload,
    ): Promise<void> {
      if (event === 'call_offer') return offer(socket, ctx, payload);
      return signal(ctx, event, payload);
    },

    /**
     * A device just connected. If a call is waiting for this user (parked), hand it over now,
     * the same way a live call_offer (and the caller's candidates) would have arrived.
     */
    async deliverParked(socket: { emit: (e: string, p: object) => unknown }, userId: string) {
      const state = await getState(userId);
      if (state?.role !== 'callee' || !state.parked || state.deviceId || state.answeredAt) return;
      const waiting = await parked.read(userId, state.callId);
      if (!waiting) return;
      socket.emit('call_offer', waiting.offer);
      for (const ice of waiting.ice) socket.emit('call_ice', ice);
    },

    /**
     * "Decline" on the call notification, with no login: the one-time token that came inside the
     * push proves it. Returns false when the token is wrong or the call is already over.
     */
    async declineFromPush(callId: string, token: string): Promise<boolean> {
      const calleeId = await parked.calleeForDeclineToken(callId, token);
      if (!calleeId) return false;
      await signal({ userId: calleeId, deviceId: '' }, 'call_reject', { call_id: callId });
      return true;
    },

    /** The user's last socket left. A brief drop (network switch) must not kill a healthy call. */
    async onUserOffline(userId: string): Promise<void> {
      const state = await getState(userId);
      if (!state) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        void (async () => {
          if (await presence.isOnline(userId)) return;
          if ((await getState(userId))?.callId !== state.callId) return;
          send(
            `user:${state.peerId}`,
            'call_end',
            { call_id: state.callId, reason: 'failed' },
            userId,
          );
          await clearCall(userId, state.peerId, state.callId);
          await dropParked(userId, state);
          await logCall(state, outcomeOf(state, false));
        })().catch((error: unknown) => deps.logger.warn({ error }, 'call cleanup failed'));
      }, graceMs);
      timer.unref();
      timers.add(timer);
    },

    close(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
export type Calls = ReturnType<typeof createCalls>;
