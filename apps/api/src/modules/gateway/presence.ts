// Presence lives in Redis, per user and aggregated over devices. Redis is a cache with TTLs, never
// the source of truth: if this server crashes, its entries simply run out.
import type { Redis } from '../../redis.js';

/** presence:user:<userId> is a sorted set: member = socket id, score = when the entry expires. */
const key = (userId: string) => `presence:user:${userId}`;

export const PRESENCE_TTL_MS = 60_000;

export function createPresence(redis: Redis) {
  async function isOnline(userId: string): Promise<boolean> {
    await redis.zremrangebyscore(key(userId), '-inf', Date.now()); // drop expired sockets
    return (await redis.zcard(key(userId))) > 0;
  }

  const touch = (userId: string, socketId: string) =>
    redis
      .multi()
      .zadd(key(userId), Date.now() + PRESENCE_TTL_MS, socketId)
      .pexpire(key(userId), PRESENCE_TTL_MS * 2)
      .exec();

  return {
    isOnline,

    /** Returns true when this socket made the user come online. */
    async add(userId: string, socketId: string): Promise<boolean> {
      const was = await isOnline(userId);
      await touch(userId, socketId);
      return !was;
    },

    /** Returns true when this was the user's last connected socket. */
    async remove(userId: string, socketId: string): Promise<boolean> {
      await redis.zrem(key(userId), socketId);
      return !(await isOnline(userId));
    },

    /** Called on a timer for every local socket, so live entries do not expire. */
    async refresh(sockets: { userId: string; socketId: string }[]): Promise<void> {
      if (sockets.length === 0) return;
      const pipeline = redis.pipeline();
      for (const s of sockets) {
        pipeline.zadd(key(s.userId), Date.now() + PRESENCE_TTL_MS, s.socketId);
        pipeline.pexpire(key(s.userId), PRESENCE_TTL_MS * 2);
      }
      await pipeline.exec();
    },
  };
}
export type Presence = ReturnType<typeof createPresence>;
