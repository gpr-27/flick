import { describe, expect, it } from 'vitest';
import { backoffDelay, isUuidV7, retry, runChecks, uuidv7, uuidv7Time } from '../src/index.js';

describe('backoffDelay', () => {
  it('doubles the ceiling each attempt and caps it at maxMs', () => {
    const ceiling = (attempt: number) =>
      backoffDelay(attempt, { baseMs: 100, maxMs: 1_000 }, () => 1);
    expect([1, 2, 3, 4, 5].map(ceiling)).toEqual([100, 200, 400, 800, 1_000]);
  });

  it('picks a random delay below the ceiling (full jitter)', () => {
    expect(backoffDelay(3, { baseMs: 100 }, () => 0.5)).toBe(200);
    expect(backoffDelay(3, { baseMs: 100 }, () => 0)).toBe(0);
  });
});

describe('retry', () => {
  const noWait = () => Promise.resolve();

  it('returns once a later attempt succeeds', async () => {
    let calls = 0;
    const result = await retry(
      () => (++calls < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve('ok')),
      { wait: noWait },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after `retries` and rethrows the last error', async () => {
    let calls = 0;
    const failing = () => Promise.reject(new Error(`fail ${String(++calls)}`));
    await expect(retry(failing, { retries: 2, wait: noWait })).rejects.toThrow('fail 3');
  });

  it('does not retry permanent errors', async () => {
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error('permanent'));
    };
    await expect(retry(failing, { shouldRetry: () => false, wait: noWait })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('uuidv7', () => {
  it('produces valid v7 ids that carry their creation time', () => {
    const id = uuidv7(1_700_000_000_123);
    expect(isUuidV7(id)).toBe(true);
    expect(uuidv7Time(id)).toBe(1_700_000_000_123);
  });

  it('stays strictly increasing within one millisecond and when the clock goes back', () => {
    const ids = [
      ...Array.from({ length: 5_000 }, () => uuidv7(2_000_000_000_000)),
      uuidv7(1_999_999_999_000), // clock stepped backwards
    ];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runChecks', () => {
  const ok = (name: string, critical = true) => ({
    name,
    critical,
    check: () => Promise.resolve(),
  });
  const down = (name: string, critical: boolean) => ({
    name,
    critical,
    check: () => Promise.reject(new Error(`${name} unreachable`)),
  });

  it('is ready when every dependency answers', async () => {
    expect((await runChecks([ok('postgres'), ok('redis')])).status).toBe('ready');
  });

  it('is degraded when only a non-critical dependency is down', async () => {
    const report = await runChecks([ok('postgres'), down('minio', false)]);
    expect(report.status).toBe('degraded');
    expect(report.checks[1]).toEqual({
      name: 'minio',
      critical: false,
      ok: false,
      error: 'minio unreachable',
    });
  });

  it('is not ready when a critical dependency is down or hangs', async () => {
    expect((await runChecks([down('postgres', true)])).status).toBe('not_ready');
    const hanging = {
      name: 'redis',
      critical: true,
      check: () => new Promise<void>(() => undefined),
    };
    const report = await runChecks([hanging], 20);
    expect(report.status).toBe('not_ready');
    expect(report.checks[0]?.error).toBe('redis did not answer within 20ms');
  });
});
