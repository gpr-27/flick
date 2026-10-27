import { sql, type Kysely } from 'kysely';

// Who asked for a transcript (or last edited it), so "Download / Clear my AI data" can find the
// transcripts a person caused. The transcript itself stays shared with the chat.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE message_transcripts
      ADD COLUMN author_id uuid REFERENCES users (id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE message_transcripts DROP COLUMN author_id`.execute(db);
}
