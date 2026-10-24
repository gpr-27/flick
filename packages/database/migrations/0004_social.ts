import { sql, type Kysely } from 'kysely';

// Blocks, contacts, group invites, call history, push subscriptions and abuse reports.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE join_request_status AS ENUM ('pending', 'approved', 'rejected');
    CREATE TYPE call_type AS ENUM ('audio', 'video');
    CREATE TYPE call_status AS ENUM ('ringing', 'ongoing', 'completed', 'missed', 'rejected');
    CREATE TYPE report_status AS ENUM ('open', 'actioned', 'dismissed');

    CREATE TABLE blocks (
      blocker_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      blocked_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_id),
      CONSTRAINT blocks_self_ck CHECK (blocker_id <> blocked_id)
    );

    CREATE TABLE contacts (
      owner_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      contact_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      nickname         text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, contact_user_id),
      CONSTRAINT contacts_self_ck CHECK (owner_id <> contact_user_id)
    );

    CREATE TABLE invite_links (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id    uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
      -- SHA-256 of the token in the link; the raw token is never stored.
      token_hash         bytea NOT NULL,
      expires_at         timestamptz,
      max_uses           integer,
      use_count          integer NOT NULL DEFAULT 0,
      requires_approval  boolean NOT NULL DEFAULT false,
      revoked_at         timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT invite_links_uses_ck CHECK (max_uses IS NULL OR use_count <= max_uses)
    );
    -- Opening an invite link finds it by token hash.
    CREATE UNIQUE INDEX invite_links_token_hash_uq ON invite_links (token_hash);

    CREATE TABLE join_requests (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      status           join_request_status NOT NULL DEFAULT 'pending',
      created_at       timestamptz NOT NULL DEFAULT now(),
      decided_at       timestamptz,
      decided_by       uuid REFERENCES users (id) ON DELETE SET NULL
    );
    -- One pending request per user per group, and it is the admin's list of pending requests.
    CREATE UNIQUE INDEX join_requests_pending_uq ON join_requests (conversation_id, user_id) WHERE status = 'pending';

    CREATE TABLE call_logs (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      caller_id        uuid REFERENCES users (id) ON DELETE SET NULL,
      type             call_type NOT NULL,
      status           call_status NOT NULL DEFAULT 'ringing',
      started_at       timestamptz NOT NULL DEFAULT now(),
      answered_at      timestamptz,
      ended_at         timestamptz
    );
    -- The calls tab lists the calls in the user's conversations, newest first.
    CREATE INDEX call_logs_conversation_idx ON call_logs (conversation_id, started_at DESC);

    CREATE TABLE push_subscriptions (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      device_id    uuid REFERENCES devices (id) ON DELETE CASCADE,
      endpoint     text NOT NULL,
      p256dh       text NOT NULL,
      auth         text NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      -- Set when the push service says the subscription is gone (HTTP 404/410).
      disabled_at  timestamptz
    );
    -- Subscribing the same browser again updates its row instead of adding one.
    CREATE UNIQUE INDEX push_subscriptions_endpoint_uq ON push_subscriptions (endpoint);
    -- Sending a notification loads the user's working subscriptions.
    CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id) WHERE disabled_at IS NULL;

    CREATE TABLE reports (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id      uuid REFERENCES users (id) ON DELETE SET NULL,
      reported_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      conversation_id  uuid REFERENCES conversations (id) ON DELETE SET NULL,
      reason           text NOT NULL,
      -- Copies of the reported messages, so moderators see them even if they are later deleted.
      evidence         jsonb NOT NULL DEFAULT '[]',
      status           report_status NOT NULL DEFAULT 'open',
      created_at       timestamptz NOT NULL DEFAULT now(),
      resolved_at      timestamptz
    );
    -- The moderation queue lists open reports, oldest first.
    CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE reports, push_subscriptions, call_logs, join_requests, invite_links, contacts, blocks;
    DROP TYPE report_status, call_status, call_type, join_request_status;
  `.execute(db);
}
