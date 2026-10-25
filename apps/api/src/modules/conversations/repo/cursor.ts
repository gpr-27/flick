import { ApiError } from '../http/errors.js';

// Cursors are opaque to clients: base64url of the last row's sort key.
export const encodeCursor = (key: string) => Buffer.from(key).toString('base64url');

export function decodeCursor(cursor: string): string {
  const key = Buffer.from(cursor, 'base64url').toString();
  // A NUL character cannot be stored or compared in Postgres text; refuse it here, not as a 500.
  if (!key || key.includes('\u0000')) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
  return key;
}
