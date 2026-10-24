import type { Redis } from 'ioredis';
import type { AiLogger, ProviderName } from './types.js';

export function cooldownKey(provider: ProviderName, account: string, model: string): string {
  return `ai:cooldown:${provider}:${account}:${model}`;
}

/** Pluggable cooldown storage. Implementations must fail open (never throw) or the chain treats errors as "not cooling". */
export interface CooldownStore {
  /** Remaining cooldown in ms; 0 when not cooling down. */
  remainingMs(key: string): Promise<number>;
  set(key: string, ttlMs: number, reason: string): Promise<void>;
  clear(key: string): Promise<void>;
}

export class MemoryCooldownStore implements CooldownStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  remainingMs(key: string): Promise<number> {
    const until = this.entries.get(key);
    if (until === undefined) return Promise.resolve(0);
    const left = until - this.now();
    if (left <= 0) {
      this.entries.delete(key);
      return Promise.resolve(0);
    }
    return Promise.resolve(left);
  }

  set(key: string, ttlMs: number, _reason?: string): Promise<void> {
    if (ttlMs > 0) this.entries.set(key, this.now() + ttlMs);
    return Promise.resolve();
  }

  clear(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

export type RedisCooldownClient = Pick<Redis, 'set' | 'pttl' | 'del'>;

/** Shared across API replicas. Redis is ephemeral state only; on Redis errors it fails open. */
export class RedisCooldownStore implements CooldownStore {
  constructor(
    private readonly redis: RedisCooldownClient,
    private readonly logger?: AiLogger,
  ) {}

  async remainingMs(key: string): Promise<number> {
    try {
      const ttl = await this.redis.pttl(key);
      return ttl > 0 ? ttl : 0;
    } catch (err) {
      this.logger?.warn?.({ key, err: errName(err) }, 'ai cooldown read failed; failing open');
      return 0;
    }
  }

  async set(key: string, ttlMs: number, reason: string): Promise<void> {
    if (ttlMs <= 0) return;
    try {
      await this.redis.set(key, reason, 'PX', Math.ceil(ttlMs));
    } catch (err) {
      this.logger?.warn?.({ key, err: errName(err) }, 'ai cooldown write failed');
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger?.warn?.({ key, err: errName(err) }, 'ai cooldown clear failed');
    }
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}
