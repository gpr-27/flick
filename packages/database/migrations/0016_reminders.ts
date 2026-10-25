import { sql, type Kysely } from 'kysely';

// "Remind me": a note to self that comes back at a chosen time, about one message or a whole chat.
// The row holds only ids, the time and an optional note. The message text is never copied into
// it; it is read when the reminder is sent, so a deleted message cannot leak through a reminder.
// The worker delivers what is due, once (status moves from 'pending' to 'sent').
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE reminders (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      -- NULL = a reminder about the chat itself, not one message.
      message_id       uuid REFERENCES messages (id) ON DELETE CASCADE,
      note             text,
      remind_at        timestamptz NOT NULL,
      status           text NOT NULL DEFAULT 'pending',
      created_at       timestamptz NOT NULL DEFAULT now(),
      sent_at          timestamptz,
      CONSTRAINT reminders_status_ck CHECK (status IN ('pending', 'sent', 'cancelled')),
      CONSTRAINT reminders_note_ck CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200)
    );
    -- The worker looks for due rows; only pending rows are in the index.
    CREATE INDEX reminders_due_idx ON reminders (remind_at) WHERE status = 'pending';
    -- "My reminders" list and the per-user limit.
    CREATE INDEX reminders_user_idx ON reminders (user_id, remind_at, id);
    -- Marks on a message and cleanup when a message goes away.
    CREATE INDEX reminders_message_idx ON reminders (message_id) WHERE message_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE reminders`.execute(db);
}
