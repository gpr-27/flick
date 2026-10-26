import { sql, type Kysely } from 'kysely';

// Talking to Flick: facts it remembers about a user, topics (fresh contexts) inside the Flick
// chat, and thumbs up/down on its answers.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE ai_memories (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      fact       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX ai_memories_user_idx ON ai_memories (user_id, created_at DESC)`.execute(
    db,
  );
  await sql`
    CREATE TABLE ai_topics (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title                text NOT NULL,
      started_message_seq  bigint NOT NULL,
      created_at           timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX ai_topics_user_idx ON ai_topics (user_id, started_message_seq DESC)`.execute(
    db,
  );
  await sql`
    CREATE TABLE ai_feedback (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      rating     text NOT NULL CHECK (rating IN ('up', 'down')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, message_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE ai_feedback`.execute(db);
  await sql`DROP TABLE ai_topics`.execute(db);
  await sql`DROP TABLE ai_memories`.execute(db);
}
