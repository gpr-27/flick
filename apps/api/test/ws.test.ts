import { afterEach, describe, expect, it } from 'vitest';
import { createRedis, type Redis } from '../src/redis.js';

// How the API's Redis client behaves when Redis does not answer.

describe('createRedis', () => {
  const clients: Redis[] = [];
  afterEach(() => {
    for (const r of clients.splice(0)) r.disconnect();
  });

  it('a command to an unreachable Redis gives up within about a second (it does not wait for the 10 s connect timeout)', async () => {
    // 10.255.255.1 is not routable: depending on the machine the attempt hangs or fails at once
    const redis = createRedis('redis://10.255.255.1:6379');
    redis.on('error', () => undefined);
    clients.push(redis);
    const started = Date.now();
    await expect(redis.get('anything')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('a command to a refused connection fails fast too', async () => {
    const redis = createRedis('redis://127.0.0.1:1');
    redis.on('error', () => undefined);
    clients.push(redis);
    const started = Date.now();
    await expect(redis.set('k', 'v')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
