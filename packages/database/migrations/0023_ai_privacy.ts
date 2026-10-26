import { sql, type Kysely } from 'kysely';

// "Allow Flick to read this chat": one row per user and chat when the user changed the default (on).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE ai_chat_privacy (
      user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      allow           boolean NOT NULL DEFAULT true,
      updated_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, conversation_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE ai_chat_privacy`.execute(db);
}
