import { sql, type Kysely } from 'kysely';

// One unsent draft per person per chat, so a half-written message follows you to another device.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE conversation_drafts (
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      body             text NOT NULL,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, conversation_id),
      CONSTRAINT conversation_drafts_body_ck CHECK (length(body) BETWEEN 1 AND 65000)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE conversation_drafts;`.execute(db);
}
