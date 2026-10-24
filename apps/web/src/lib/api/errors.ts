// One error type for every HTTP failure the app can see. The server's error shape is
// ErrorResponse from @chat/contracts: { error: { code, message, retryable, details? } }.

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const INVALID_RESPONSE = 'INVALID_RESPONSE';
export const UNAUTHORIZED = 'UNAUTHORIZED';

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /** The server's own verdict (ErrorBody.retryable); when absent we guess from the status. */
  retryable?: boolean;
  cause?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  private readonly serverRetryable: boolean | undefined;

  constructor({ status, code, message, details, retryable, cause }: ApiErrorInit) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.serverRetryable = retryable;
  }

  /** Network failures, timeouts, rate limits and 5xx are worth retrying. */
  get retryable(): boolean {
    if (this.serverRetryable !== undefined) return this.serverRetryable;
    return (
      this.status === 0 ||
      this.status === 408 ||
      this.status === 429 ||
      (this.status >= 500 && this.status !== 501)
    );
  }

  static fromResponse(status: number, body: unknown, fallbackMessage: string): ApiError {
    let code = status === 401 ? UNAUTHORIZED : `HTTP_${status}`;
    let message = fallbackMessage;
    let details: unknown;
    let retryable: boolean | undefined;
    if (isRecord(body) && isRecord(body.error)) {
      const err = body.error;
      if (typeof err.code === 'string' && err.code) code = err.code;
      if (typeof err.message === 'string' && err.message) message = err.message;
      if (typeof err.retryable === 'boolean') retryable = err.retryable;
      details = err.details;
    }
    return new ApiError({
      status,
      code,
      message,
      details,
      ...(retryable === undefined ? {} : { retryable }),
    });
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** A human-readable message for any thrown value. */
export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
};
