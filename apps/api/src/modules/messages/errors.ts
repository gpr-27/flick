import { ERROR_CODES, makeError, type ErrorBody, type ErrorCode } from '@chat/contracts';
import { DbError } from '@chat/db';
import { ZodError } from 'zod';

/** A failure the client should see, with one of the contract's error codes. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code].http;
  }

  toBody(): ErrorBody {
    return makeError(this.code, this.message, this.details);
  }
}

const DB_ERROR_CODES: Record<DbError['code'], ErrorCode> = {
  conversation_not_found: 'NOT_FOUND',
  // Same answer for "no such conversation" and "not yours", so ids cannot be probed.
  not_a_member: 'NOT_A_MEMBER',
  not_allowed: 'FORBIDDEN',
  idempotency_conflict: 'CONFLICT',
  attachment_not_found: 'NOT_FOUND',
};

/** Turns anything thrown by the domain code or the DB helpers into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DbError) return new ApiError(DB_ERROR_CODES[err.code], err.message);
  if (err instanceof ZodError) {
    return new ApiError('VALIDATION_FAILED', 'Invalid request.', { issues: err.issues });
  }
  const internal = new ApiError('INTERNAL', 'Something went wrong.');
  internal.cause = err; // for the server log; never sent to the client
  return internal;
}
