// Flick's server runs on a free plan that goes to sleep when nobody is using it, and waking it
// takes about a minute. During that time every request fails, which looks like a broken app.
// This module asks the server "are you awake?" (the cheap /health/live route), and tells the page
// when the answer is slow so it can say what is happening instead of leaving a blank screen.

/** A healthy server answers this fast; slower than this and we tell the person it is waking up. */
export const SLOW_AFTER_MS = 3_000;
/** One try may take this long before it counts as "not up yet". */
export const ATTEMPT_TIMEOUT_MS = 8_000;
/** Pause between tries. */
export const RETRY_MS = 3_000;
/** After this long we stop (and hide the notice): something else is wrong, the app's own errors say what. */
export const GIVE_UP_MS = 4 * 60_000;

export interface WaitOptions {
  fetchImpl?: typeof fetch;
  slowAfterMs?: number;
  attemptTimeoutMs?: number;
  retryMs?: number;
  giveUpMs?: number;
  /** Called when the server has not answered in time (and again after each failed try). */
  onWaking: () => void;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Resolves with `true` when the server answers OK, or `false` if we gave up (or were cancelled).
 * A fast server never triggers `onWaking`, so a healthy start shows nothing at all.
 */
export async function waitForServer(url: string, options: WaitOptions): Promise<boolean> {
  const {
    fetchImpl = fetch,
    slowAfterMs = SLOW_AFTER_MS,
    attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
    retryMs = RETRY_MS,
    giveUpMs = GIVE_UP_MS,
    onWaking,
    signal,
  } = options;
  const startedAt = Date.now();
  const slow = setTimeout(onWaking, slowAfterMs);
  try {
    while (!signal?.aborted && Date.now() - startedAt < giveUpMs) {
      const attempt = new AbortController();
      const cut = setTimeout(() => {
        attempt.abort();
      }, attemptTimeoutMs);
      try {
        const res = await fetchImpl(url, { signal: attempt.signal, cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        // no answer, a timeout or a network error: the server is not up yet
      } finally {
        clearTimeout(cut);
      }
      onWaking();
      await sleep(retryMs, signal);
    }
    return false;
  } finally {
    clearTimeout(slow);
  }
}
