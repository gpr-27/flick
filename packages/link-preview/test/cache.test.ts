import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryPreviewCache, RedisPreviewCache, type CacheEntry } from '../src/cache.js';

const okEntry: CacheEntry = {
  ok: true,
  preview: {
    url: 'https://example.com/',
    title: 'T',
    description: null,
    siteName: null,
    imageUrl: null,
  },
};

describe('MemoryPreviewCache', () => {
  it('stores, expires and evicts', async () => {
    let now = 1_000_000;
    const cache = new MemoryPreviewCache({ now: () => now, maxEntries: 2 });
    await cache.set('a', okEntry, 60);
    await cache.set('neg', { ok: false, code: 'TIMEOUT' }, 10);
    expect(await cache.get('a')).toEqual(okEntry);
    expect(await cache.get('neg')).toEqual({ ok: false, code: 'TIMEOUT' });

    now += 10_000;
    expect(await cache.get('neg')).toBeNull();
    expect(await cache.get('a')).toEqual(okEntry);

    await cache.set('b', okEntry, 60);
    await cache.set('c', okEntry, 60); // evicts least recently used ("a")
    expect(cache.size).toBe(2);
    expect(await cache.get('a')).toBeNull();
  });

  it('enforces the byte cap', async () => {
    const cache = new MemoryPreviewCache({ maxBytes: 400 });
    for (let i = 0; i < 10; i++) await cache.set(`k${i}`, okEntry, 60);
    expect(cache.size).toBeLessThan(10);
    expect(await cache.get('k9')).toEqual(okEntry);
  });
});

/**
 * Runs against a real Redis when TEST_REDIS_URL is set (CI / compose.test.yml).
 * Locally: docker run --rm -d -p 0:6379 redis:7-alpine, then export the URL.
 */
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(redisUrl === undefined)('RedisPreviewCache (real Redis)', () => {
  let redis: Redis;
  const prefix = `lp-test-${process.pid}-${Date.now()}:`;

  beforeAll(() => {
    redis = new Redis(redisUrl ?? '', { lazyConnect: false, maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('round-trips entries with TTLs', async () => {
    const cache = new RedisPreviewCache(redis, { keyPrefix: prefix });
    await cache.set('pos', okEntry, 86_400);
    await cache.set('neg', { ok: false, code: 'BLOCKED_ADDRESS' }, 3_600);
    expect(await cache.get('pos')).toEqual(okEntry);
    expect(await cache.get('neg')).toEqual({ ok: false, code: 'BLOCKED_ADDRESS' });
    const ttlPos = await redis.ttl(`${prefix}pos`);
    const ttlNeg = await redis.ttl(`${prefix}neg`);
    expect(ttlPos).toBeGreaterThan(86_000);
    expect(ttlNeg).toBeGreaterThan(3_500);
    expect(ttlNeg).toBeLessThanOrEqual(3_600);
  });

  it('treats corrupt entries as a miss', async () => {
    await redis.set(`${prefix}bad`, '{"ok":true,"preview":{"url":5}}');
    const cache = new RedisPreviewCache(redis, { keyPrefix: prefix });
    expect(await cache.get('bad')).toBeNull();
    expect(await cache.get('missing')).toBeNull();
  });
});
