import { sql, type Kysely } from 'kysely';

// Search was slow for common words (about 100 ms at 1M messages, measured in
// docs/performance/database.md). Search always looks inside the user's own chats, so the planner
// walks those chats one by one. With the old index (search only) it re-read the whole posting
// list of the word for every chat. The new index also holds conversation_id (btree_gin), so each
// chat is a short lookup.
//
// It replaces the old index under the same name, so the write cost is one index, not two.
// The build locks writes to `messages` for a few seconds at this size; run it in a quiet period.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS btree_gin;
    DROP INDEX messages_search_idx;
    CREATE INDEX messages_search_idx ON messages USING gin (conversation_id, search);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX messages_search_idx;
    CREATE INDEX messages_search_idx ON messages USING gin (search);
  `.execute(db);
}
