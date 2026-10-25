import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './helpers.js';

// A cut database connection must never take the whole process down.

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase({ poolMax: 5 });
});
afterAll(async () => {
  await t.destroy();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createPool', () => {
  it('survives a connection that is cut while a client is checked out and idle (between two statements of a transaction)', async () => {
    const uncaught: unknown[] = [];
    const listener = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', listener);
    try {
      const client = await t.pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      // another connection kills it, as a failover, a restart or a proxy would
      await t.pool.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
      await sleep(400);
      // the next statement on that client fails the normal way (a rejected promise), it does not crash
      await expect(client.query('SELECT 1')).rejects.toThrow();
      client.release(true);
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', listener);
    }
  });

  it('survives a connection that is cut while it is idle in the pool, and the next query opens a new one', async () => {
    const uncaught: unknown[] = [];
    const listener = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', listener);
    try {
      const { rows } = await t.pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await t.pool.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]).catch(() => undefined);
      await sleep(400);
      const again = await t.pool.query<{ one: number }>('SELECT 1 AS one');
      expect(again.rows[0]!.one).toBe(1);
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', listener);
    }
  });

  it('reads bigint columns as numbers (seqs) and refuses ones that do not fit', async () => {
    const { rows } = await t.pool.query<{ n: number }>('SELECT 9007199254740991::bigint AS n');
    expect(rows[0]!.n).toBe(9_007_199_254_740_991);
    await expect(t.pool.query('SELECT 9007199254740993::bigint AS n')).rejects.toThrow(/too large/);
  });
});
