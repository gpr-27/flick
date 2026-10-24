// Durations use performance.now(): it is monotonic, so it never jumps when the wall clock is
// adjusted (NTP, manual changes). Date.now() is only for timestamps that are stored or shown.

/** Returns a function that gives the seconds elapsed since startTimer() was called. */
export function startTimer(): () => number {
  const start = performance.now();
  return () => (performance.now() - start) / 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError if `promise` has not settled within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(message));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
