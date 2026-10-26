import { describe, expect, it } from 'vitest';
import { clearAiData, exportAiData } from '../src/modules/ai/data-registry.js';
import { nextMidnightUtc, quotaMessage, takeQuota } from '../src/modules/ai/quota.js';

function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    incr: (k: string) => Promise.resolve(counts.set(k, (counts.get(k) ?? 0) + 1).get(k)!),
    expire: () => Promise.resolve(1),
    hincrby: () => Promise.resolve(1),
  } as never;
}

describe('ai quota', () => {
  it('allows up to the limit then refuses', async () => {
    const redis = fakeRedis();
    expect(await takeQuota(redis, 'u', 'chat', 2)).toBe(true);
    expect(await takeQuota(redis, 'u', 'chat', 2)).toBe(true);
    expect(await takeQuota(redis, 'u', 'chat', 2)).toBe(false);
  });
  it('fails open when Redis is down', async () => {
    const broken = { incr: () => Promise.reject(new Error('down')) } as never;
    expect(await takeQuota(broken, 'u', 'chat', 1)).toBe(true);
  });
  it('words the error and resets at midnight UTC', () => {
    expect(quotaMessage(200)).toBe('Daily AI limit reached (200). Resets at midnight UTC');
    expect(nextMidnightUtc(new Date('2026-10-27T15:00:00Z')).toISOString()).toBe(
      '2026-10-28T00:00:00.000Z',
    );
  });
});

describe('ai data registry', () => {
  it('runs registered exporters', async () => {
    const { registerAiDataExporter, registerAiDataCleaner } =
      await import('../src/modules/ai/data-registry.js');
    let cleaned = '';
    registerAiDataExporter((u) => Promise.resolve({ u }), 'x');
    registerAiDataCleaner((u) => {
      cleaned = u;
      return Promise.resolve();
    });
    expect(await exportAiData('me')).toMatchObject({ x: { u: 'me' } });
    await clearAiData('me');
    expect(cleaned).toBe('me');
  });
});
