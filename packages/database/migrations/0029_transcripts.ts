import { sql, type Kysely } from 'kysely';

// Voice-note transcripts (shared by everyone in the chat, searchable) and the translation settings:
// per-chat auto-translate, per-chat and global auto-transcribe, and the "don't translate" word list.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE message_transcripts (
      message_id uuid PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
      language   text,
      text       text NOT NULL,
      summary    text,
      search     tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
  await sql`CREATE INDEX message_transcripts_search_idx ON message_transcripts USING gin (search)`.execute(
    db,
  );
  await sql`
    CREATE TABLE auto_translate_prefs (
      user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      target_language text NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    );
  `.execute(db);
  await sql`
    CREATE TABLE transcript_prefs (
      user_id         uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      auto_transcribe boolean NOT NULL DEFAULT false,
      dont_translate  text[] NOT NULL DEFAULT '{}'
    );
  `.execute(db);
  await sql`
    CREATE TABLE chat_transcribe_prefs (
      user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      enabled         boolean NOT NULL,
      PRIMARY KEY (user_id, conversation_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE chat_transcribe_prefs`.execute(db);
  await sql`DROP TABLE transcript_prefs`.execute(db);
  await sql`DROP TABLE auto_translate_prefs`.execute(db);
  await sql`DROP TABLE message_transcripts`.execute(db);
}
