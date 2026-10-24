import { sql, type Kysely } from 'kysely';

import type { Database } from '../types.js';

// The oldest unpublished events. FOR UPDATE SKIP LOCKED lets several dispatchers run at once:
// each one locks a different batch instead of waiting for, or duplicating, another's.
export function buildOutboxClaimQuery(db: Kysely<Database>, limit: number) {
  return db
    .selectFrom('outbox')
    .selectAll()
    .where('published_at', 'is', null)
    .orderBy('id')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

// Backlog size and age, for the outbox_pending and outbox_oldest_age_seconds metrics.
export async function outboxBacklog(
  db: Kysely<Database>,
): Promise<{ pending: number; oldestAgeSeconds: number }> {
  const result = await sql<{ pending: number; oldest_age_seconds: number | null }>`
    SELECT count(*)::int AS pending,
           extract(epoch FROM now() - min(created_at))::float8 AS oldest_age_seconds
    FROM outbox WHERE published_at IS NULL
  `.execute(db);
  const row = result.rows[0]!;
  return { pending: row.pending, oldestAgeSeconds: row.oldest_age_seconds ?? 0 };
}

// Retention: published events are kept 7 days and dedupe records 14 days (longer than the
// broker can redeliver an event).
export async function purgeOldOutboxRows(
  db: Kysely<Database>,
): Promise<{ outbox: number; processedEvents: number }> {
  const outbox = await db
    .deleteFrom('outbox')
    .where('published_at', '<', sql<Date>`now() - interval '7 days'`)
    .executeTakeFirst();
  const processed = await db
    .deleteFrom('processed_events')
    .where('processed_at', '<', sql<Date>`now() - interval '14 days'`)
    .executeTakeFirst();
  return {
    outbox: Number(outbox.numDeletedRows),
    processedEvents: Number(processed.numDeletedRows),
  };
}
