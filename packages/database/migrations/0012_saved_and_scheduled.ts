import { sql, type Kysely } from 'kysely';

// 1. "Saved messages": a chat with yourself. It is a normal direct conversation with one member;
//    saved_for names that member. UNIQUE means a user has at most one, and lets two racing
//    requests create it safely (the loser's insert does nothing).
// 2. Scheduled messages: text the server sends later. The row is the durable source of truth;
//    the worker sends what is due, once (status moves from 'pending' to 'sent' or 'failed').
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE conversations
      ADD COLUMN saved_for uuid UNIQUE REFERENCES users (id) ON DELETE CASCADE;

    CREATE TABLE scheduled_messages (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      body_text        text NOT NULL,
      send_at          timestamptz NOT NULL,
      status           text NOT NULL DEFAULT 'pending',
      -- Why a scheduled message could not be sent (for example the user left the group).
      failed_reason    text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT scheduled_messages_status_ck CHECK (status IN ('pending', 'sent', 'failed')),
      CONSTRAINT scheduled_messages_text_ck CHECK (length(body_text) BETWEEN 1 AND 16000)
    );
    -- The worker looks for due rows; only pending rows are in the index.
    CREATE INDEX scheduled_messages_due_idx ON scheduled_messages (send_at) WHERE status = 'pending';
    -- "My scheduled messages" screen.
    CREATE INDEX scheduled_messages_user_idx ON scheduled_messages (user_id, send_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE scheduled_messages;
    ALTER TABLE conversations DROP COLUMN saved_for;
  `.execute(db);
}
