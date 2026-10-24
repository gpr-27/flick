import { sql, type Kysely } from 'kysely';

// Call links for LiveKit group calls. Like invite_links, only the hash of the token is stored.
// A link lets a signed-in user join the call room; it never makes them a conversation member.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE call_links (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
      token_hash       bytea NOT NULL,
      media            call_type NOT NULL,
      expires_at       timestamptz NOT NULL,
      max_uses         integer,
      use_count        integer NOT NULL DEFAULT 0,
      revoked_at       timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT call_links_uses_ck CHECK (max_uses IS NULL OR use_count <= max_uses)
    );
    -- Opening a call link finds it by token hash.
    CREATE UNIQUE INDEX call_links_token_hash_uq ON call_links (token_hash);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE call_links;`.execute(db);
}
