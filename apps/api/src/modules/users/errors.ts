import { ERROR_CODES, makeError, type ErrorCode } from '@chat/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

/** Throw this from a handler wrapped in `handle()`; it becomes the standard `{ error }` body. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function sendError(reply: FastifyReply, error: ApiError) {
  return reply.code(ERROR_CODES[error.code].http).send({
    error: makeError(error.code, error.message, error.details),
  });
}

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Turns a thrown ApiError into its HTTP response. Anything else is a bug and goes to the global handler. */
export function handle(handler: Handler): Handler {
  return async (req, reply) => {
    try {
      return await handler(req, reply);
    } catch (error) {
      if (error instanceof ApiError) return sendError(reply, error);
      throw error;
    }
  };
}

/** Validates request input with the contract's zod schema. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError('VALIDATION_FAILED', 'Invalid request', {
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}
