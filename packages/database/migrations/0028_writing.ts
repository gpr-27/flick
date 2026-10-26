import { sql, type Kysely } from 'kysely';

// Writing help: a cached summary of how the user writes (plus their Flick persona), and an
// optional style per chat.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE ai_style_profiles (
      user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      summary    text NOT NULL DEFAULT '',
      persona    jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`
    CREATE TABLE ai_chat_style (
      user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      style           text NOT NULL,
      custom          text,
      updated_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, conversation_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE ai_chat_style`.execute(db);
  await sql`DROP TABLE ai_style_profiles`.execute(db);
}
