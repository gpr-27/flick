// Errors thrown by the query helpers. The API maps `code` to its own error codes.
export type DbErrorCode =
  | 'conversation_not_found'
  | 'not_a_member'
  | 'not_allowed'
  | 'idempotency_conflict'
  | 'attachment_not_found';

export class DbError extends Error {
  constructor(
    readonly code: DbErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

// Postgres error code of a driver error, e.g. '23505' for a unique violation.
export function pgErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
