import type { Redis } from 'ioredis';
import type { AiLogger } from './types.js';

export interface RateLimitHit {
  count: number;
  /** ms until the window resets. */
  resetMs: number;
}

/** Fixed-window counter per key. */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
      if (this.windows.size > 50_000) this.sweep(t);
    }
    w.count += 1;
    return Promise.resolve({ count: w.count, resetMs: w.resetAt - t });
  }

  private sweep(t: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
  }
}

const HIT_SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end
return {c, t}`;

export type RedisRateLimitClient = Pick<Redis, 'eval'>;

/** Distributed limiter shared by API replicas. Fails open when Redis is down. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisRateLimitClient,
    private readonly logger?: AiLogger,
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    try {
      const res = (await this.redis.eval(HIT_SCRIPT, 1, key, String(windowMs))) as [number, number];
      return { count: Number(res[0]), resetMs: Number(res[1]) };
    } catch (err) {
      this.logger?.warn?.(
        { err: err instanceof Error ? err.name : 'unknown' },
        'ai rate limit store failed; failing open',
      );
      return { count: 0, resetMs: windowMs };
    }
  }
}
