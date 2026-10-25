import { ERROR_CODES, makeError, type ErrorBody, type ErrorCode } from '@chat/contracts';

// One error body for the whole API: { error: { code, message, retryable } } (the contract's
// ErrorResponse). Most routes build it themselves; this is for everything that does not: Fastify's
// own errors (bad JSON, body too large, wrong content type), the rate limiter, unknown URLs, the
// login guard, and the routes of packages that have their own format (the AI and link-preview
// plugins answer { error: 'ai_unavailable', message }).

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  501: 'FEATURE_DISABLED',
  503: 'SERVICE_UNAVAILABLE',
  504: 'TIMEOUT',
};

export function codeForStatus(status: number): ErrorCode {
  const known = CODE_BY_STATUS[status];
  if (known) return known;
  return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
}

export function errorBodyForStatus(
  status: number,
  message: string,
  requestId?: string,
  details?: Record<string, unknown>,
): ErrorBody & { requestId?: string } {
  const body: ErrorBody & { requestId?: string } = makeError(
    codeForStatus(status),
    // Fastify puts the offending URL in some messages; the contract allows 1000 characters.
    (message || 'Request failed').slice(0, 300),
    details,
  );
  if (requestId) body.requestId = requestId;
  return body;
}

/**
 * True if any string anywhere in the value contains a NUL character. Postgres text and jsonb
 * cannot hold U+0000, so such input would fail inside the database as a server error; it is
 * the caller's mistake and is refused up front.
 */
export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 64 || typeof value !== 'object' || value === null) return false;
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    if (containsNul(item, depth + 1)) return true;
  }
  return false;
}

/**
 * Turns an error body that is not the standard one into the standard one. Returns null when the
 * body is already standard (or is not an error body at all), so the caller leaves it alone.
 */
export function normalizeErrorPayload(
  status: number,
  payload: string,
  requestId: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return null;
  const { error } = parsed;
  const message = (parsed as { message?: unknown }).message;

  if (typeof error === 'string') {
    // { error: 'ai_unavailable', message: '...' } from a package. A name that is one of our codes
    // becomes the code; any other name is kept as details.reason.
    const upper = error.toUpperCase();
    const isCode = upper in ERROR_CODES;
    const body = errorBodyForStatus(
      status,
      typeof message === 'string' ? message : error,
      requestId,
      isCode ? undefined : { reason: error },
    );
    if (isCode) {
      body.code = upper;
      body.retryable = ERROR_CODES[upper as ErrorCode].retryable;
    }
    return JSON.stringify({ error: body });
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && typeof e.message === 'string') return null; // already standard
    return JSON.stringify({
      error: errorBodyForStatus(status, typeof e.message === 'string' ? e.message : '', requestId),
    });
  }
  return null;
}
