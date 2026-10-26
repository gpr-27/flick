import { sql, type Kysely } from 'kysely';

// Group tools: slow mode (seconds a member must wait between messages) and a welcome text for new members.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE conversations
      ADD COLUMN slow_mode_seconds integer NOT NULL DEFAULT 0 CHECK (slow_mode_seconds BETWEEN 0 AND 86400),
      ADD COLUMN welcome_text text CHECK (char_length(welcome_text) <= 1000);
  `.execute(db);
  // New message kinds. Postgres cannot drop an enum value, so down() leaves them.
  for (const kind of ['checklist', 'expense', 'game']) {
    await sql.raw(`ALTER TYPE message_type ADD VALUE IF NOT EXISTS '${kind}'`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE conversations DROP COLUMN slow_mode_seconds, DROP COLUMN welcome_text`.execute(
    db,
  );
}
