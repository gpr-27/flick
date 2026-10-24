import { ERROR_CODES, type ErrorCode, makeError } from '@chat/contracts';
import { DbError } from '@chat/db';
import type { FastifyInstance } from 'fastify';

/** An error the client should see, with a contract error code. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// What a removed member must see: the same 404 as a conversation that does not exist, so the
// API never confirms that a conversation exists to someone outside it.
export const notFound = () => new ApiError('NOT_FOUND', 'Conversation not found');
export const forbidden = (message: string) => new ApiError('FORBIDDEN', message);

/** Replies with the contract's { error: { code, message, retryable } } for ApiError and DbError. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    const apiError = error instanceof ApiError ? error : fromDbError(error);
    if (apiError) {
      return reply
        .code(ERROR_CODES[apiError.code].http)
        .send({ error: makeError(apiError.code, apiError.message) });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    const message = status >= 500 ? 'Internal server error' : error.message;
    return reply.code(status).send({ error: { message, requestId: req.id } });
  });
}

function fromDbError(error: Error): ApiError | undefined {
  if (!(error instanceof DbError)) return undefined;
  if (error.code === 'conversation_not_found') return notFound();
  if (error.code === 'not_a_member') return new ApiError('NOT_A_MEMBER', error.message);
  if (error.code === 'not_allowed') return new ApiError('FORBIDDEN', error.message);
  return undefined;
}
