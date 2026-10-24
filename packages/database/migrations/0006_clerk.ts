import { sql, type Kysely } from 'kysely';

// Login moved to Clerk. Passwords and refresh-token sessions are gone; a local user row is
// just the app-side profile of one Clerk user. `devices` stays: delivery and presence are per device.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN clerk_id text;
    -- The picture from the Clerk profile (a full URL). avatar_object_key is for uploaded pictures.
    ALTER TABLE users ADD COLUMN avatar_url text;
    -- Several NULLs are allowed: the bot and seeded demo users have no Clerk account.
    CREATE UNIQUE INDEX users_clerk_id_uq ON users (clerk_id);
    ALTER TABLE users DROP COLUMN password_hash; -- also drops users_password_hash_ck
    DROP TABLE sessions;
    DROP TYPE session_revoke_reason;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE session_revoke_reason AS ENUM ('rotated', 'logout', 'reuse_detected', 'revoked');
    CREATE TABLE sessions (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      device_id           uuid REFERENCES devices (id) ON DELETE SET NULL,
      family_id           uuid NOT NULL,
      refresh_token_hash  bytea NOT NULL,
      rotated_from        uuid REFERENCES sessions (id) ON DELETE SET NULL,
      user_agent          text,
      ip                  inet,
      created_at          timestamptz NOT NULL DEFAULT now(),
      expires_at          timestamptz NOT NULL,
      revoked_at          timestamptz,
      revoke_reason       session_revoke_reason,
      CONSTRAINT sessions_token_hash_ck CHECK (octet_length(refresh_token_hash) = 32),
      CONSTRAINT sessions_revoke_ck CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
    );
    CREATE UNIQUE INDEX sessions_refresh_token_hash_uq ON sessions (refresh_token_hash);
    CREATE INDEX sessions_family_idx ON sessions (family_id);
    CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
    CREATE INDEX sessions_rotated_from_idx ON sessions (rotated_from) WHERE rotated_from IS NOT NULL;

    ALTER TABLE users ADD COLUMN password_hash text;
    ALTER TABLE users ADD CONSTRAINT users_password_hash_ck
      CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%');
    DROP INDEX users_clerk_id_uq;
    ALTER TABLE users DROP COLUMN clerk_id, DROP COLUMN avatar_url;
  `.execute(db);
}
