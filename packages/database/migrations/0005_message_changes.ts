import { sql, type Kysely } from 'kysely';

// What edits, deletes and reactions need beyond the messages table:
//   message_events  - the change log. Each change takes the next conversation seq, so sync can
//                     replay it in order and a device can detect a missed one (no holes in seq).
//   hidden_messages - "delete for me": a per-user hide that takes no seq.
//   view_once_opens - who has opened a view-once message (it is hidden from them afterwards).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- The contract's client_message_id is any 8-64 character id (A-Z a-z 0-9 _ -), not a uuid.
    ALTER TABLE messages ALTER COLUMN client_message_id TYPE text;

    CREATE TYPE message_event_type AS ENUM ('edited', 'deleted', 'reaction_added', 'reaction_removed');

    CREATE TABLE message_events (
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      -- Comes from the same counter as messages.seq, so the two never collide.
      seq              bigint NOT NULL,
      type             message_event_type NOT NULL,
      message_id       uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      -- Who made the change (editor, deleter, reactor).
      user_id          uuid REFERENCES users (id) ON DELETE SET NULL,
      emoji            text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, seq),
      CONSTRAINT message_events_seq_ck CHECK (seq > 0)
    );
    CREATE INDEX message_events_message_idx ON message_events (message_id);

    CREATE TABLE hidden_messages (
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      hidden_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id)
    );

    CREATE TABLE view_once_opens (
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      opened_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE view_once_opens, hidden_messages, message_events;
    DROP TYPE message_event_type;
    ALTER TABLE messages ALTER COLUMN client_message_id TYPE uuid USING client_message_id::uuid;
  `.execute(db);
}
