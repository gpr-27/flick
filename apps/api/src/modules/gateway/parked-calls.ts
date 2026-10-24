// A call offer for someone with no connected device waits here, in Redis, for a short time.
// If their app connects inside the window (they tapped "Answer" on the notification, or just
// opened Flick) the gateway hands it over right after the handshake. Keys are per callee and call.
import { timingSafeEqual } from 'node:crypto';
import type { Redis } from '../../redis.js';

/** How long a ringing call waits for the callee to come online. */
export const PARKED_TTL_MS = 45_000;
/** Caller candidates that arrive while parked are kept too, up to this many. */
const MAX_PARKED_ICE = 64;

/** What the callee's client receives, exactly as if it had been online (call_offer / call_ice). */
export interface ParkedOffer {
  call_id: string;
  conversation_id: string;
  media: 'audio' | 'video';
  sdp: { type: 'offer' | 'answer'; sdp: string };
  from_user_id: string;
}
export interface ParkedIce {
  call_id: string;
  candidate: object | null;
  from_user_id: string;
}

const offerKey = (calleeId: string, callId: string) => `call:parked:${calleeId}:${callId}`;
const iceKey = (calleeId: string, callId: string) => `call:parked-ice:${calleeId}:${callId}`;
// The push carries this token so the notification's Decline button can work with no login.
const tokenKey = (callId: string) => `call:decline-token:${callId}`;

export function createParkedCalls(redis: Redis, ttlMs: number = PARKED_TTL_MS) {
  return {
    ttlMs,

    async park(calleeId: string, offer: ParkedOffer, declineToken: string): Promise<void> {
      const token = JSON.stringify({ user_id: calleeId, token: declineToken });
      await redis
        .multi()
        .set(offerKey(calleeId, offer.call_id), JSON.stringify(offer), 'PX', ttlMs)
        .set(tokenKey(offer.call_id), token, 'PX', ttlMs)
        .exec();
    },

    /** Keeps a caller candidate for the callee, but only while the offer itself is still parked. */
    async addIce(calleeId: string, ice: ParkedIce): Promise<void> {
      if (!(await redis.exists(offerKey(calleeId, ice.call_id)))) return;
      const key = iceKey(calleeId, ice.call_id);
      await redis
        .multi()
        .rpush(key, JSON.stringify(ice))
        .ltrim(key, -MAX_PARKED_ICE, -1)
        .pexpire(key, ttlMs)
        .exec();
    },

    async read(
      calleeId: string,
      callId: string,
    ): Promise<{ offer: ParkedOffer; ice: ParkedIce[] } | null> {
      const raw = await redis.get(offerKey(calleeId, callId));
      if (!raw) return null;
      const ice = await redis.lrange(iceKey(calleeId, callId), 0, -1);
      return {
        offer: JSON.parse(raw) as ParkedOffer,
        ice: ice.map((i) => JSON.parse(i) as ParkedIce),
      };
    },

    async clear(calleeId: string, callId: string): Promise<void> {
      await redis.del(offerKey(calleeId, callId), iceKey(calleeId, callId), tokenKey(callId));
    },

    /** The callee the token belongs to, or null if it is wrong, expired or the call is over. */
    async calleeForDeclineToken(callId: string, token: string): Promise<string | null> {
      const raw = await redis.get(tokenKey(callId));
      if (!raw) return null;
      const stored = JSON.parse(raw) as { user_id: string; token: string };
      const a = Buffer.from(stored.token);
      const b = Buffer.from(token);
      return a.length === b.length && timingSafeEqual(a, b) ? stored.user_id : null;
    },
  };
}
export type ParkedCalls = ReturnType<typeof createParkedCalls>;
