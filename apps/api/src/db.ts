import { Kysely, PostgresDialect } from 'kysely';

import { createPool, type Database } from '@chat/db';
import { dbQueryDuration, watchDbPool } from './metrics.js';

export type { Database };
export type Db = Kysely<Database>;

/** Kysely over a pg pool. The pool opens connections lazily, on the first query. */
export function createDb(url: string, poolMax: number): Db {
  // createPool parses bigint columns (seq, last_seq) as numbers, matching the Database types.
  const pool = createPool({ connectionString: url, max: poolMax, application_name: 'chat-api' });
  // Connections checked out right now (read at scrape time). The DbPoolSaturation alert watches it.
  watchDbPool(() => pool.totalCount - pool.idleCount);
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: (event) => {
      if (event.level === 'query') dbQueryDuration.observe(event.queryDurationMillis / 1000);
    },
  });
}
