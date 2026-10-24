import type { Redis } from '../../../redis.js';

// Who is in a group call, kept in Redis. LiveKit does not tell us, and a call has no "end" event,
// so each participant's client sends a beat every ~25 s and the entry lives for HOLD_MS. If a tab
// is closed or the network drops, the entry just expires: the call is over when nobody is left.
const HOLD_MS = 75_000;

const key = (conversationId: string) => `groupcall:${conversationId}`;

async function prune(redis: Redis, conversationId: string, now: number): Promise<void> {
  await redis.zremrangebyscore(key(conversationId), '-inf', now);
}

export async function beat(redis: Redis, conversationId: string, userId: string): Promise<void> {
  const now = Date.now();
  await prune(redis, conversationId, now);
  await redis.zadd(key(conversationId), now + HOLD_MS, userId);
  await redis.pexpire(key(conversationId), HOLD_MS * 2);
}

export async function leave(redis: Redis, conversationId: string, userId: string): Promise<void> {
  await redis.zrem(key(conversationId), userId);
}

export async function participants(redis: Redis, conversationId: string): Promise<number> {
  const now = Date.now();
  await prune(redis, conversationId, now);
  return redis.zcard(key(conversationId));
}
