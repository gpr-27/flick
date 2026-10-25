import { sql, type Kysely } from 'kysely';

// 1. The notification centre: one row per alert a person got (or would have got) for a message,
//    a reminder or a missed call. It holds no message text: the screen reads the preview live
//    from the message, so a deleted or expired message disappears from it too.
// 2. Push subscriptions remember what the last push to them did (for troubleshooting), and the
//    device's own choices (message previews, quiet hours) so the server can honour them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE notifications (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id  uuid REFERENCES conversations (id) ON DELETE CASCADE,
      -- Null for alerts that are not about one message (a reminder, a missed call).
      message_id       uuid REFERENCES messages (id) ON DELETE CASCADE,
      kind             text NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      read_at          timestamptz,
      CONSTRAINT notifications_kind_ck
        CHECK (kind IN ('message', 'mention', 'reply', 'reminder', 'missed_call')),
      -- A message alerts a person once, even if the dispatcher or the job runs twice.
      -- (Postgres treats nulls as different, so alerts without a message are not limited.)
      CONSTRAINT notifications_user_message_uq UNIQUE (user_id, message_id)
    );
    -- The screen lists one person's alerts newest first (keyset paging on created_at, id).
    CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);
    -- The daily purge deletes alerts older than 30 days.
    CREATE INDEX notifications_created_idx ON notifications (created_at);

    ALTER TABLE push_subscriptions
      ADD COLUMN prefs            jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN last_attempt_at  timestamptz,
      ADD COLUMN last_success_at  timestamptz,
      -- HTTP status the push service gave the last time (201 = accepted; 0 = no answer).
      ADD COLUMN last_status      integer;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE push_subscriptions
      DROP COLUMN prefs, DROP COLUMN last_attempt_at, DROP COLUMN last_success_at,
      DROP COLUMN last_status;
    DROP TABLE notifications;
  `.execute(db);
}
