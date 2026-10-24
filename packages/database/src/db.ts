import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './types.js';

const INT8_OID = 20;

// pg returns bigint as a string by default. Seqs and counters stay far below 2^53, so we read
// them as numbers, and fail loudly instead of losing precision if one ever gets that big.
export function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`bigint ${value} is too large for a JS number`);
  return n;
}

// The parser is set per pool, not on the global pg.types, so other pools in the process are unaffected.
const types: pg.CustomTypesConfig = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => {
    if (oid === INT8_OID && format !== 'binary') return parseInt8;
    const fallback: unknown = pg.types.getTypeParser(oid, format);
    return fallback as (value: string) => unknown;
  },
};

export function createPool(
  options: Omit<pg.PoolConfig, 'types'> & { connectionString: string },
): pg.Pool {
  const pool = new pg.Pool({ max: 10, ...options, types });
  // When Postgres restarts or a connection is cut, an idle client emits 'error'. pg already removes
  // that client from the pool and the next query opens a new one; without a listener the event
  // would crash the whole process.
  pool.on('error', () => undefined);
  return pool;
}

// The pool should come from createPool() so bigint columns match ./types.ts. db.destroy() ends the pool.
export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
