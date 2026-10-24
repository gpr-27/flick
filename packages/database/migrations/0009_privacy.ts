import { sql, type Kysely } from 'kysely';

// Who may see my "about" (the other privacy settings already exist). The product has no contact
// list, so the "contacts" audience is gone: anyone who had it now has "nobody".
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE user_settings ADD COLUMN about_privacy privacy_level NOT NULL DEFAULT 'everyone';
    UPDATE user_settings SET last_seen_privacy = 'nobody' WHERE last_seen_privacy = 'contacts';
    UPDATE user_settings SET photo_privacy = 'nobody' WHERE photo_privacy = 'contacts';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE user_settings DROP COLUMN about_privacy;`.execute(db);
}
