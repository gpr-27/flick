/** Sleep that rejects with the signal's reason when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Rejects as soon as `signal` aborts, even if `promise` ignores the signal. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        // Pass provider errors through untouched so classifyError sees status/headers.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(e);
      },
    );
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  const r: unknown = signal?.reason;
  return r instanceof Error ? r : new Error('aborted');
}

type HeaderBag = { get(name: string): string | null } | Record<string, unknown> | undefined | null;

export function headerValue(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v ?? undefined;
  }
  const rec = headers as Record<string, unknown>;
  const v = rec[name] ?? rec[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/**
 * Retry delay in ms from `retry-after-ms`, `retry-after` (seconds or HTTP date),
 * or a Google-style `"retryDelay": "37s"` in the error body.
 */
export function parseRetryAfterMs(
  headers: HeaderBag,
  bodyText: string,
  nowMs: number,
): number | undefined {
  const ms = headerValue(headers, 'retry-after-ms');
  if (ms !== undefined) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  const ra = headerValue(headers, 'retry-after');
  if (ra !== undefined) {
    const n = Number(ra);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bodyText);
  if (m?.[1]) return Math.ceil(Number(m[1]) * 1000);
  return undefined;
}
