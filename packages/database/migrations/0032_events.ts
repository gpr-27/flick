import { sql, type Kysely } from 'kysely';

// Shared events: an "Event" card in a chat (kind 'event') and who is going. The card itself
// (title, time, place) is the message; only the answers live here.
export async function up(db: Kysely<unknown>): Promise<void> {
  // Postgres cannot drop an enum value, so down() leaves it.
  await sql`ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'event'`.execute(db);
  await sql`
    CREATE TABLE event_rsvps (
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      response    text NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id),
      CONSTRAINT event_rsvps_response_ck CHECK (response IN ('going', 'maybe', 'no'))
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE event_rsvps`.execute(db);
}
