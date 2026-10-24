import { ApiError } from '../errors.js';

// Keyset cursors carry the timestamp exactly as Postgres printed it, because a JS Date would
// round the microseconds and make a page skip or repeat rows.
export function encodeKeyset(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

export function decodeKeyset(cursor: string): { at: string; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof at === 'string' && typeof id === 'string') return { at, id };
  } catch {
    // fall through to the error below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor.');
}
