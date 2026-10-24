import { sql, type Kysely } from 'kysely';

// The transactional outbox, consumer dedupe and the audit log.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Events written in the same transaction as the data change, then published to Redpanda
    -- by the worker. This avoids losing events the way a separate "write DB, then publish" would.
    CREATE TABLE outbox (
      id             bigserial PRIMARY KEY,
      -- Consumers remember processed event ids, so publishing the same row twice is harmless.
      event_id       uuid NOT NULL DEFAULT gen_random_uuid(),
      topic          text NOT NULL,
      -- Kafka key; the conversation id, so one conversation's events stay in order on one partition.
      partition_key  text NOT NULL,
      payload        jsonb NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      published_at   timestamptz,
      attempts       integer NOT NULL DEFAULT 0,
      last_error     text,
      CONSTRAINT outbox_event_id_uq UNIQUE (event_id)
    );
    -- The publisher repeatedly asks for the oldest unpublished rows; the index holds only that backlog.
    CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;
    -- The retention job deletes rows published more than 7 days ago.
    CREATE INDEX outbox_published_at_idx ON outbox (published_at) WHERE published_at IS NOT NULL;

    -- A consumer inserts (consumer, event_id) in the same transaction as its side effect, so a
    -- redelivered event is skipped instead of processed twice.
    CREATE TABLE processed_events (
      consumer      text NOT NULL,
      event_id      uuid NOT NULL,
      processed_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (consumer, event_id)
    );
    -- The retention job deletes dedupe records older than the broker can redeliver.
    CREATE INDEX processed_events_processed_at_idx ON processed_events (processed_at);

    CREATE TABLE audit_log (
      id          bigserial PRIMARY KEY,
      user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
      -- e.g. 'auth.login', 'auth.refresh_reuse_detected', 'group.member_removed'
      action      text NOT NULL,
      ip          inet,
      metadata    jsonb NOT NULL DEFAULT '{}',
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    -- Security review shows one user's recent actions.
    CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE audit_log, processed_events, outbox;`.execute(db);
}
