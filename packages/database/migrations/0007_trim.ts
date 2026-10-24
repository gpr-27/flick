import { sql, type Kysely } from 'kysely';

// Removes the dropped location, live location and contact card message types. Postgres cannot
// drop a value from an enum, so message_type is rebuilt without them. Messages of those types
// are deleted first (their reactions, receipts and so on cascade).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM messages WHERE type::text IN ('location', 'live_location', 'contact');

    ALTER TYPE message_type RENAME TO message_type_old;
    CREATE TYPE message_type AS ENUM (
      'text', 'image', 'file', 'voice', 'video', 'gif', 'sticker', 'poll', 'system', 'call_event'
    );
    ALTER TABLE messages ALTER COLUMN type TYPE message_type USING type::text::message_type;
    DROP TYPE message_type_old;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TYPE message_type RENAME TO message_type_new;
    CREATE TYPE message_type AS ENUM (
      'text', 'image', 'file', 'voice', 'video', 'gif', 'sticker', 'poll',
      'location', 'live_location', 'contact', 'system', 'call_event'
    );
    ALTER TABLE messages ALTER COLUMN type TYPE message_type USING type::text::message_type;
    DROP TYPE message_type_new;
  `.execute(db);
}
