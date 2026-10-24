// 1:1 call signaling. The server only relays SDP and ICE; media is peer to peer.
//
// Safety rule: after an offer pairs two users, every other call event is relayed only to the
// peer of the sender's active call with the same call_id. The client never says who to send to.
// Call state is in Redis so it works across API replicas.
import type { Server } from 'socket.io';
import type { AuthContext } from '../../auth-guard.js';
import type { Db } from '../../db.js';
import type { Logger } from '../../logger.js';
import type { Redis } from '../../redis.js';
import { recordCall, type RecordCallInput } from '../calls/index.js';
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
}

const CALL_TTL_SECONDS = 6 * 60 * 60; // a safety net if a server dies mid-call
const RECONNECT_GRACE_MS = 10_000;
const callKey = (userId: string) => `call:user:${userId}`;

export function createCalls(deps: {
  io: Server;
  db: Db;
  redis: Redis;
  repo: GatewayRepo;
  presence: Presence;
  logger: Logger;
  graceMs?: number;
}) {
  const { io, redis, repo, presence } = deps;
  const graceMs = deps.graceMs ?? RECONNECT_GRACE_MS;
  const timers = new Set<NodeJS.Timeout>();

  const getState = async (userId: string): Promise<CallState | null> => {
    const raw = await redis.get(callKey(userId));
    return raw ? (JSON.parse(raw) as CallState) : null;
  };
  const setState = (userId: string, state: CallState) =>
    redis.set(callKey(userId), JSON.stringify(state), 'EX', CALL_TTL_SECONDS);
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

  async function offer(
    socket: { id: string; emit: (e: string, p: object) => unknown },
    ctx: AuthContext,
    p: CallPayload,
  ): Promise<void> {
    const callId = p.call_id;
    const unavailable = (reason: 'blocked' | 'offline') =>
      socket.emit('call_unavailable', { call_id: callId, reason });

    const peerId = await repo.directPeer(p.conversation_id!, ctx.userId);
    if (!peerId) return; // not a direct conversation of this user
    if (await repo.isBlockedEitherWay(ctx.userId, peerId)) return void unavailable('blocked');
    if (!(await presence.isOnline(peerId))) return void unavailable('offline');

    // Either side on a different call means busy; never overwrite a live pairing.
    const [theirs, mine] = await Promise.all([getState(peerId), getState(ctx.userId)]);
    if ((theirs && theirs.callId !== callId) || (mine && mine.callId !== callId)) {
      socket.emit('call_busy', { call_id: callId, from_user_id: peerId });
      return;
    }
    const shared = {
      callId,
      conversationId: p.conversation_id!,
      callerId: ctx.userId,
      media: p.media ?? 'audio',
      startedAt: Date.now(),
      answeredAt: null,
    };
    await Promise.all([
      setState(ctx.userId, {
        ...shared,
        peerId,
        role: 'caller',
        deviceId: ctx.deviceId,
        peerDeviceId: null,
      }),
      setState(peerId, {
        ...shared,
        peerId: ctx.userId,
        role: 'callee',
        deviceId: null,
        peerDeviceId: ctx.deviceId,
      }),
    ]);
    send(`user:${peerId}`, 'call_offer', p, ctx.userId);
  }

  async function signal(ctx: AuthContext, event: CallEventName, p: CallPayload): Promise<void> {
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
        return stopOtherDevices();
      }
      case 'call_reject':
      case 'call_busy':
      case 'call_end':
        relay();
        await clearCall(ctx.userId, mine.peerId, p.call_id);
        await logCall(mine, outcomeOf(mine, event !== 'call_end'));
        if (!mine.deviceId) stopOtherDevices(); // we were still ringing
        return;
      default: // call_ice, call_renegotiate
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
