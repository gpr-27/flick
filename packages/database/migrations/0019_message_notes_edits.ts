import { sql, type Kysely } from 'kysely';

// Edit history (the body before each edit) and private per-user notes on messages.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE message_edits (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      -- The text before this edit.
      body_text   text,
      edited_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX message_edits_message_idx ON message_edits (message_id, edited_at);

    CREATE TABLE message_notes (
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      body        text NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id),
      CONSTRAINT message_notes_body_ck CHECK (length(body) BETWEEN 1 AND 1000)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE message_notes; DROP TABLE message_edits;`.execute(db);
}
