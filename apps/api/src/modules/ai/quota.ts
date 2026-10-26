import type { Redis } from '../../redis.js';

// A per-user daily AI quota, counted in Redis. The day runs midnight to midnight UTC.
// Redis down: fail open (the minute limiter and the providers' own limits still apply).

const day = (now = new Date()): string => now.toISOString().slice(0, 10);

export function nextMidnightUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export const quotaMessage = (limit: number): string =>
  `Daily AI limit reached (${limit}). Resets at midnight UTC`;

const totalKey = (userId: string, d: string) => `ai:quota:${userId}:${d}`;
const featureKey = (userId: string, d: string) => `ai:quota:features:${userId}:${d}`;

/** Counts one AI request. Returns false when the user is already over the limit. */
export async function takeQuota(
  redis: Redis,
  userId: string,
  feature: string,
  limit: number,
): Promise<boolean> {
  try {
    const d = day();
    const count = await redis.incr(totalKey(userId, d));
    if (count === 1) await redis.expire(totalKey(userId, d), 3 * 86_400);
    if (count > limit) return false;
    const fk = featureKey(userId, d);
    await redis.hincrby(fk, feature, 1);
    await redis.expire(fk, 3 * 86_400);
    return true;
  } catch {
    return true;
  }
}

export interface Usage {
  used: number;
  limit: number;
  resets_at: string;
  by_feature: { feature: string; count: number }[];
}

export async function readUsage(redis: Redis, userId: string, limit: number): Promise<Usage> {
  const d = day();
  let used = 0;
  let features: Record<string, string> = {};
  try {
    used = Number((await redis.get(totalKey(userId, d))) ?? 0);
    features = await redis.hgetall(featureKey(userId, d));
  } catch {
    // show zero rather than fail the page
  }
  return {
    used: Math.min(used, limit),
    limit,
    resets_at: nextMidnightUtc().toISOString(),
    by_feature: Object.entries(features)
      .map(([feature, count]) => ({ feature, count: Number(count) }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function clearUsage(redis: Redis, userId: string): Promise<void> {
  const d = day();
  await redis.del(featureKey(userId, d)).catch(() => undefined); // the total stays: the limit is not a data reset
}

/** "/ai/summarize" -> "summarize" */
export const featureOf = (url: string): string => url.replace(/^\/ai\//, '') || 'ai';
