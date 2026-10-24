import { sleep } from './time.js';

export interface BackoffOptions {
  baseMs?: number; // delay before the first retry, before jitter (default 100)
  maxMs?: number; // cap for any single delay (default 30s)
}

/**
 * Exponential backoff with "full jitter": a random delay between 0 and base * 2^(attempt-1),
 * capped at maxMs. The randomness spreads out clients that failed at the same moment (for
 * example every browser reconnecting after a server restart), so they do not retry in lockstep.
 * `attempt` starts at 1 for the first retry.
 */
export function backoffDelay(
  attempt: number,
  { baseMs = 100, maxMs = 30_000 }: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return random() * exponential;
}

export interface RetryOptions extends BackoffOptions {
  retries?: number; // retries after the first try (default 3)
  shouldRetry?: (error: unknown) => boolean; // return false for permanent errors
  wait?: (ms: number) => Promise<void>; // injectable for tests
}

/** Calls `fn` until it succeeds, waiting backoffDelay() between tries; rethrows the last error. */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, shouldRetry = () => true, wait = sleep } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt > retries || !shouldRetry(error)) throw error;
      await wait(backoffDelay(attempt, options));
    }
  }
}
