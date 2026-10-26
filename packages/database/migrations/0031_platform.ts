import { sql, type Kysely } from 'kysely';

// Incoming webhooks (one token per hook, stored as a hash) and the "new device" login alert switch.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE chat_webhooks (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      created_by      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash      text NOT NULL,
      name            text NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX chat_webhooks_conversation_idx ON chat_webhooks (conversation_id)`.execute(
    db,
  );
  await sql`ALTER TABLE user_settings ADD COLUMN login_alerts boolean NOT NULL DEFAULT true`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE user_settings DROP COLUMN login_alerts`.execute(db);
  await sql`DROP TABLE chat_webhooks`.execute(db);
}
