import { sql, type Kysely } from 'kysely';

// The in-app guide: which tips and tours a person has seen or used, so the guide follows them to
// every device. Only topic ids and times are stored (see docs/features/guide.md).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE user_settings ADD COLUMN guide jsonb NOT NULL DEFAULT '{}'::jsonb;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE user_settings DROP COLUMN guide;`.execute(db);
}
