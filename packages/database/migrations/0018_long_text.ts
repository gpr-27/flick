import { sql, type Kysely } from 'kysely';

// Text messages may now be up to 65,000 characters (LIMITS.MAX_TEXT_LENGTH), so a scheduled
// message must be able to hold as much. `messages.body_text` is an unbounded text column with no
// length check, so only the scheduled_messages constraint changes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE scheduled_messages DROP CONSTRAINT scheduled_messages_text_ck;
    ALTER TABLE scheduled_messages
      ADD CONSTRAINT scheduled_messages_text_ck CHECK (length(body_text) BETWEEN 1 AND 65000);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE scheduled_messages DROP CONSTRAINT scheduled_messages_text_ck;
    ALTER TABLE scheduled_messages
      ADD CONSTRAINT scheduled_messages_text_ck CHECK (length(body_text) BETWEEN 1 AND 16000);
  `.execute(db);
}
