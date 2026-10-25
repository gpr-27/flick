import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForServer } from './serverWake';

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));
const status = (code: number) => () => Promise.resolve(new Response('', { status: code }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('waitForServer', () => {
  it('a server that answers at once never shows the "waking up" notice', async () => {
    const onWaking = vi.fn();
    const result = waitForServer('http://x/health/live', { fetchImpl: vi.fn(ok), onWaking });
    expect(await result).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onWaking).not.toHaveBeenCalled();
  });

  it('a slow server shows the notice after 3 s and it ends when the server answers', async () => {
    let answer: (r: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const onWaking = vi.fn();
    const result = waitForServer('http://x/health/live', { fetchImpl, onWaking });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(onWaking).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onWaking).toHaveBeenCalledTimes(1);
    answer(new Response('{}', { status: 200 }));
    expect(await result).toBe(true);
  });

  it('keeps trying after errors, "waking" answers (502/503) and timeouts, until it is up', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockImplementationOnce(status(503))
      .mockImplementationOnce(status(502))
      .mockImplementation(ok);
    const onWaking = vi.fn();
    const result = waitForServer('http://x/health/live', { fetchImpl, onWaking });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onWaking).toHaveBeenCalled();
  });

  it('an attempt that hangs is cut off after its timeout and tried again', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      calls += 1;
      if (calls > 1) return ok();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const result = waitForServer('http://x/health/live', {
      fetchImpl,
      onWaking: vi.fn(),
      attemptTimeoutMs: 1_000,
      retryMs: 500,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe(true);
    expect(calls).toBe(2);
  });

  it('gives up after the limit and says so (false), so the notice cannot stay for ever', async () => {
    const result = waitForServer('http://x/health/live', {
      fetchImpl: vi.fn(status(503)),
      onWaking: vi.fn(),
      giveUpMs: 20_000,
      retryMs: 3_000,
    });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await result).toBe(false);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const result = waitForServer('http://x/health/live', {
      fetchImpl: vi.fn(status(503)),
      onWaking: vi.fn(),
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe(false);
  });
});
