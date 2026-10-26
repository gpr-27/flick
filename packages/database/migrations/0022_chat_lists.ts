import { sql, type Kysely } from 'kysely';

// Per-user chat folders (kind 'folder') and coloured tags (kind 'tag'). One table keeps it small:
// a list is a name (and a colour for tags) plus the ids of the chats in it. Only the owner sees it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE chat_lists (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind             text NOT NULL,
      name             text NOT NULL,
      color            text,
      conversation_ids uuid[] NOT NULL DEFAULT '{}',
      created_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chat_lists_kind_ck CHECK (kind IN ('folder', 'tag')),
      CONSTRAINT chat_lists_name_ck CHECK (length(name) BETWEEN 1 AND 30)
    );
    CREATE INDEX chat_lists_user_idx ON chat_lists (user_id, kind, created_at);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE chat_lists`.execute(db);
}
