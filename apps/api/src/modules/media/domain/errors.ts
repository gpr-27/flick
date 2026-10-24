import { ERROR_CODES, makeError, type ErrorCode } from '@chat/contracts';

/** A failure the client should see, with the shared error code. Anything else becomes a 500. */
export class MediaError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  get status(): number {
    return ERROR_CODES[this.code].http;
  }

  toBody() {
    return { error: makeError(this.code, this.message) };
  }
}
