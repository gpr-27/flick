import { sql, type Kysely } from 'kysely';

// Account settings: the language the user wants Flick (the AI assistant) to answer in. NULL means
// "answer in the language of the message". The device and delete-account features need no new
// columns: `devices.revoked_at` and `users.status = 'deleted'` already exist.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE user_settings
      ADD COLUMN ai_language text,
      ADD CONSTRAINT user_settings_ai_language_ck CHECK (ai_language IS NULL OR char_length(ai_language) BETWEEN 2 AND 40);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE user_settings
      DROP CONSTRAINT user_settings_ai_language_ck,
      DROP COLUMN ai_language;
  `.execute(db);
}
