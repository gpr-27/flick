import { z } from 'zod';

/**
 * Every error code, with whether retrying can help.
 * - retryable: the same request may succeed later; retry with backoff and the same client_message_id.
 * - permanent: retrying the same request will fail again; show the error instead.
 */
export const ERROR_CODES = {
  // bad request
  VALIDATION_FAILED: { retryable: false, http: 400 },
  PAYLOAD_TOO_LARGE: { retryable: false, http: 413 },
  // auth
  UNAUTHORIZED: { retryable: false, http: 401 },
  // permission / existence
  FORBIDDEN: { retryable: false, http: 403 },
  NOT_A_MEMBER: { retryable: false, http: 403 },
  BLOCKED: { retryable: false, http: 403 },
  NOT_FOUND: { retryable: false, http: 404 },
  // business rules
  CONFLICT: { retryable: false, http: 409 },
  GROUP_FULL: { retryable: false, http: 409 },
  INVITE_INVALID: { retryable: false, http: 404 },
  EDIT_WINDOW_EXPIRED: { retryable: false, http: 409 },
  VIEW_ONCE_ALREADY_OPENED: { retryable: false, http: 409 },
  UPLOAD_INCOMPLETE: { retryable: true, http: 409 },
  UNSUPPORTED_MEDIA_TYPE: { retryable: false, http: 415 },
  FEATURE_DISABLED: { retryable: false, http: 501 }, // e.g. LiveKit or GIPHY not configured
  // transient
  RATE_LIMITED: { retryable: true, http: 429 },
  TIMEOUT: { retryable: true, http: 504 },
  SERVICE_UNAVAILABLE: { retryable: true, http: 503 },
  AI_UNAVAILABLE: { retryable: true, http: 503 },
  INTERNAL: { retryable: true, http: 500 },
} as const satisfies Record<string, { retryable: boolean; http: number }>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ErrorCode = z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]);

/** Same body everywhere: REST `{ error: ErrorBody }`, the WS `error` event, and `message_failed.error`. */
export const ErrorBody = z.object({
  // A plain string, not the enum, so an older client can still read a code added later
  // and fall back on `retryable`.
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(1_000),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ErrorResponse = z.object({ error: ErrorBody });

export function makeError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorBody {
  const body: ErrorBody = { code, message, retryable: ERROR_CODES[code].retryable };
  if (details) body.details = details;
  return body;
}
