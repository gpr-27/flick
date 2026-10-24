import { ApiError } from '../http/errors.js';

// Cursors are opaque to clients: base64url of the last row's sort key.
export const encodeCursor = (key: string) => Buffer.from(key).toString('base64url');

export function decodeCursor(cursor: string): string {
  const key = Buffer.from(cursor, 'base64url').toString();
  if (!key) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
  return key;
}
