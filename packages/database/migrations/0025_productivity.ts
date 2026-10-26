import { sql, type Kysely } from 'kysely';

// Personal productivity: tags on saved messages, named bookmark collections, and one settings
// row per person (digest, quiet hours, priority contacts). Only ids are stored, never message text.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE message_tags (
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      message_id  uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      tag         text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, message_id),
      CONSTRAINT message_tags_tag_ck CHECK (tag IN ('note', 'link', 'task', 'idea', 'receipt'))
    );
    CREATE TABLE bookmark_collections (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bookmark_collections_name_ck CHECK (length(name) BETWEEN 1 AND 40),
      UNIQUE (user_id, name)
    );
    CREATE TABLE bookmarks (
      user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      collection_id  uuid NOT NULL REFERENCES bookmark_collections (id) ON DELETE CASCADE,
      message_id     uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
      created_at     timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, message_id)
    );
    CREATE INDEX bookmarks_user_idx ON bookmarks (user_id, created_at DESC);
    CREATE TABLE productivity_settings (
      user_id           uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      digest            text NOT NULL DEFAULT 'off',
      quiet_enabled     boolean NOT NULL DEFAULT false,
      quiet_start       text NOT NULL DEFAULT '22:00',
      quiet_end         text NOT NULL DEFAULT '07:00',
      quiet_timezone    text NOT NULL DEFAULT 'UTC',
      -- Days (0 = Sunday) the quiet hours apply to.
      quiet_days        integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
      priority_contacts uuid[] NOT NULL DEFAULT '{}',
      last_digest_at    timestamptz,
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT productivity_digest_ck CHECK (digest IN ('off', 'daily', 'weekly'))
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE productivity_settings;
    DROP TABLE bookmarks;
    DROP TABLE bookmark_collections;
    DROP TABLE message_tags;
  `.execute(db);
}
