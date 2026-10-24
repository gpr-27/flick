import { sql, type Kysely } from 'kysely';

// Conversations, membership, attachments, the ordered message log, delivery cursors,
// reactions, polls, pins and stars.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE conversation_type AS ENUM ('direct', 'group');
    CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
    CREATE TYPE message_type AS ENUM (
      'text', 'image', 'file', 'voice', 'video', 'gif', 'sticker', 'poll',
      'location', 'live_location', 'contact', 'system', 'call_event'
    );
    CREATE TYPE attachment_status AS ENUM ('pending', 'uploaded', 'attached', 'deleted');

    CREATE TABLE conversations (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type                  conversation_type NOT NULL,
      name                  text,
      description           text,
      avatar_object_key     text,
      created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
      -- Per-conversation sequence counter. Sending a message runs
      -- UPDATE conversations SET last_seq = last_seq + 1 ... RETURNING last_seq,
      -- which locks only this row, so different conversations never wait for each other.
      last_seq              bigint NOT NULL DEFAULT 0,
      last_message_at       timestamptz,
      -- Disappearing messages: new messages expire this many seconds after they are sent (NULL = off).
      disappearing_seconds  integer,
      admin_only_send       boolean NOT NULL DEFAULT false,
      admin_only_edit       boolean NOT NULL DEFAULT false,
      -- Joining by invite link needs an admin's approval.
      approval_required     boolean NOT NULL DEFAULT false,
      created_at            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversations_last_seq_ck CHECK (last_seq >= 0),
      CONSTRAINT conversations_disappearing_ck CHECK (disappearing_seconds IS NULL OR disappearing_seconds > 0),
      CONSTRAINT conversations_group_name_ck CHECK (type = 'direct' OR name IS NOT NULL)
    );

    -- At most one direct conversation per pair of users, enforced by the database instead of a
    -- racy "check then insert" in the application.
    CREATE TABLE direct_pairs (
      user_lo          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      user_hi          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL UNIQUE REFERENCES conversations (id) ON DELETE CASCADE,
      CONSTRAINT direct_pairs_pk PRIMARY KEY (user_lo, user_hi),
      -- Storing the smaller id first means (A, B) and (B, A) are the same key.
      CONSTRAINT direct_pairs_order_ck CHECK (user_lo < user_hi)
    );

    CREATE TABLE conversation_members (
      conversation_id     uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      role                member_role NOT NULL DEFAULT 'member',
      joined_at           timestamptz NOT NULL DEFAULT now(),
      -- Members who leave keep their row so their old messages still have a sender.
      left_at             timestamptz,
      -- Highest seq the user has read; it only moves forward. Unread = last_seq - read_seq,
      -- so marking a chat read never touches message rows.
      read_seq            bigint NOT NULL DEFAULT 0,
      muted_until         timestamptz,
      archived            boolean NOT NULL DEFAULT false,
      pinned_at           timestamptz,
      favourite           boolean NOT NULL DEFAULT false,
      -- A colour or preset name chosen by this user for this chat.
      wallpaper           text,
      -- Chat lock: the client's hash of the passcode (NULL = not locked). A UI convenience, not security.
      lock_hash           text,
      PRIMARY KEY (conversation_id, user_id),
      CONSTRAINT conversation_members_read_seq_ck CHECK (read_seq >= 0)
    );
    -- Fan-out reads the active members of a conversation on every message, without the people who left.
    CREATE INDEX conversation_members_active_idx ON conversation_members (conversation_id) INCLUDE (user_id, role) WHERE left_at IS NULL;
    -- The chat list reads every conversation a user is currently in.
    CREATE INDEX conversation_members_user_idx ON conversation_members (user_id) WHERE left_at IS NULL;

    CREATE TABLE attachments (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      object_key     text NOT NULL,
      file_name      text,
      -- What the client said the file is, and what the server detected from its bytes.
      declared_mime  text NOT NULL,
      verified_mime  text,
      size_bytes     bigint NOT NULL,
      sha256         bytea,
      status         attachment_status NOT NULL DEFAULT 'pending',
      created_at     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT attachments_size_ck CHECK (size_bytes > 0),
      CONSTRAINT attachments_checksum_ck CHECK (status IN ('pending', 'deleted') OR sha256 IS NOT NULL)
    );
    -- Each storage object belongs to exactly one attachment row.
    CREATE UNIQUE INDEX attachments_object_key_uq ON attachments (object_key);
    -- The cleanup job finds uploads that were started but never finished.
    CREATE INDEX attachments_pending_idx ON attachments (created_at) WHERE status = 'pending';

    CREATE TABLE messages (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id    uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      seq                bigint NOT NULL,
      sender_id          uuid REFERENCES users (id) ON DELETE SET NULL,
      sender_device_id   uuid REFERENCES devices (id) ON DELETE SET NULL,
      -- Generated by the client; a retry reuses it, which is how duplicates are detected.
      client_message_id  uuid,
      type               message_type NOT NULL,
      body_text          text,
      -- Fields specific to the type: poll options, location, contact card, voice waveform, call details.
      content            jsonb,
      attachment_id      uuid REFERENCES attachments (id) ON DELETE SET NULL,
      -- Not a foreign key: the original may be removed by disappearing messages, and the
      -- client then shows "message unavailable".
      reply_to_id        uuid,
      forwarded          boolean NOT NULL DEFAULT false,
      view_once          boolean NOT NULL DEFAULT false,
      viewed_at          timestamptz,
      expire_at          timestamptz,
      mentions           uuid[] NOT NULL DEFAULT '{}',
      -- Imported from the old app.
      is_legacy          boolean NOT NULL DEFAULT false,
      edited_at          timestamptz,
      -- Tombstone for "delete for everyone": the row and its seq stay so sync has no gaps.
      deleted_at         timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      search             tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body_text, ''))) STORED,
      CONSTRAINT messages_seq_ck CHECK (seq > 0),
      -- A deleted message keeps no content.
      CONSTRAINT messages_tombstone_ck CHECK (deleted_at IS NULL OR (body_text IS NULL AND content IS NULL AND attachment_id IS NULL))
    );
    -- Guarantees one message per seq in a conversation, and serves history and sync: WHERE conversation_id = $1 AND seq < / > $cursor ORDER BY seq.
    ALTER TABLE messages ADD CONSTRAINT messages_conversation_seq_uq UNIQUE (conversation_id, seq);
    -- The idempotency key: a retried send hits this and becomes ON CONFLICT DO NOTHING.
    ALTER TABLE messages ADD CONSTRAINT messages_sender_device_client_id_uq UNIQUE (sender_device_id, client_message_id);
    -- Full-text search over message text.
    CREATE INDEX messages_search_idx ON messages USING gin (search);
    -- The disappearing-messages job deletes rows whose expire_at has passed.
    CREATE INDEX messages_expire_idx ON messages (expire_at) WHERE expire_at IS NOT NULL;
    -- Deleting an attachment must find the messages that point at it.
    CREATE INDEX messages_attachment_idx ON messages (attachment_id) WHERE attachment_id IS NOT NULL;

    CREATE TABLE device_cursors (
      device_id        uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      -- Highest seq this device acknowledged as delivered; it only moves forward.
      delivered_seq    bigint NOT NULL DEFAULT 0,
      -- Highest seq this device has fetched through sync; it only moves forward.
      synced_seq       bigint NOT NULL DEFAULT 0,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (device_id, conversation_id),
      CONSTRAINT device_cursors_seqs_ck CHECK (delivered_seq >= 0 AND synced_seq >= 0)
    );
    -- Delivery ticks read every device cursor of one conversation.
    CREATE INDEX device_cursors_conversation_idx ON device_cursors (conversation_id);

    CREATE TABLE reactions (
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      emoji       text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      -- The same user cannot add the same emoji to a message twice.
      CONSTRAINT reactions_pk PRIMARY KEY (message_id, user_id, emoji)
    );

    -- The poll's options are in messages.content; option_index points into that list.
    CREATE TABLE poll_votes (
      message_id    uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      option_index  smallint NOT NULL,
      voted_at      timestamptz NOT NULL DEFAULT now(),
      -- One vote per user per option (single-choice polls replace the user's vote instead).
      CONSTRAINT poll_votes_pk PRIMARY KEY (message_id, user_id, option_index),
      CONSTRAINT poll_votes_option_ck CHECK (option_index >= 0)
    );

    -- Messages pinned to the top of a conversation, visible to every member.
    CREATE TABLE pinned_messages (
      message_id       uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      pinned_by        uuid REFERENCES users (id) ON DELETE SET NULL,
      pinned_at        timestamptz NOT NULL DEFAULT now()
    );
    -- Opening a chat loads its pinned messages.
    CREATE INDEX pinned_messages_conversation_idx ON pinned_messages (conversation_id);

    -- Messages a user starred for themselves.
    CREATE TABLE starred_messages (
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      starred_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id)
    );
    -- Deleting a message (for example when it disappears) must find its stars.
    CREATE INDEX starred_messages_message_idx ON starred_messages (message_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE starred_messages, pinned_messages, poll_votes, reactions, device_cursors, messages,
      attachments, conversation_members, direct_pairs, conversations;
    DROP TYPE attachment_status, message_type, member_role, conversation_type;
  `.execute(db);
}
