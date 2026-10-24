import { sql, type Kysely } from 'kysely';

// Users, their devices and refresh-token sessions.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TYPE user_status AS ENUM ('active', 'disabled', 'deleted');
    CREATE TYPE privacy_level AS ENUM ('everyone', 'contacts', 'nobody');
    CREATE TYPE device_platform AS ENUM ('web', 'android', 'ios', 'desktop');
    CREATE TYPE session_revoke_reason AS ENUM ('rotated', 'logout', 'reuse_detected', 'revoked');

    CREATE TABLE users (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- citext makes uniqueness case-insensitive: "Alice" and "alice" are the same account.
      username           citext NOT NULL,
      email              citext,
      -- argon2id hash. NULL for bots, and for users imported from the old app until they reset their password.
      password_hash      text,
      display_name       text NOT NULL,
      avatar_object_key  text,
      about              text,
      status             user_status NOT NULL DEFAULT 'active',
      -- The "@flick" AI assistant is a bot user, so its replies are ordinary messages.
      is_bot             boolean NOT NULL DEFAULT false,
      -- Throwaway "Try demo" accounts, so a cleanup job can find them.
      is_demo            boolean NOT NULL DEFAULT false,
      -- Id from the old MongoDB app, so the import script can be re-run safely.
      legacy_id          text,
      last_seen_at       timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_username_format_ck CHECK (username ~ '^[A-Za-z0-9_.]{3,32}$'),
      CONSTRAINT users_password_hash_ck CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
      CONSTRAINT users_display_name_ck CHECK (char_length(display_name) BETWEEN 1 AND 64),
      CONSTRAINT users_about_ck CHECK (about IS NULL OR char_length(about) <= 139)
    );
    -- Login looks users up by username, and the unique index stops two signups taking the same name.
    CREATE UNIQUE INDEX users_username_uq ON users (username);
    -- Login and password reset look users up by email; NULL emails do not collide.
    CREATE UNIQUE INDEX users_email_uq ON users (email);
    -- Makes the legacy import idempotent; partial because only imported users have a legacy_id.
    CREATE UNIQUE INDEX users_legacy_id_uq ON users (legacy_id) WHERE legacy_id IS NOT NULL;
    -- People search uses display_name ILIKE '%term%', which only a trigram index can serve.
    CREATE INDEX users_display_name_trgm_idx ON users USING gin (display_name gin_trgm_ops);

    -- The Flick assistant. Its fixed id is FLICK_BOT_USER_ID in src/bot.ts.
    INSERT INTO users (id, username, display_name, about, is_bot)
    VALUES ('00000000-0000-4000-8000-00000000f11c', 'flick', 'Flick', 'Your AI assistant. Mention @flick to ask me anything.', true);

    CREATE TABLE user_settings (
      user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      last_seen_privacy   privacy_level NOT NULL DEFAULT 'everyone',
      photo_privacy       privacy_level NOT NULL DEFAULT 'everyone',
      groups_add_privacy  privacy_level NOT NULL DEFAULT 'everyone',
      read_receipts       boolean NOT NULL DEFAULT true
    );

    -- A logged-in browser or app. Delivery is tracked per device, so a user's phone and laptop
    -- each catch up on their own.
    CREATE TABLE devices (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name            text NOT NULL DEFAULT 'Unnamed device',
      platform        device_platform NOT NULL DEFAULT 'web',
      created_at      timestamptz NOT NULL DEFAULT now(),
      last_active_at  timestamptz NOT NULL DEFAULT now(),
      revoked_at      timestamptz
    );
    -- Delivery and presence look up a user's active devices.
    CREATE INDEX devices_user_active_idx ON devices (user_id) WHERE revoked_at IS NULL;

    CREATE TABLE sessions (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      device_id           uuid REFERENCES devices (id) ON DELETE SET NULL,
      -- Every refresh token descended from one login shares a family; reusing an old token revokes the family.
      family_id           uuid NOT NULL,
      -- SHA-256 of the refresh token. The raw token is never stored.
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
    -- Every refresh request finds its session by token hash.
    CREATE UNIQUE INDEX sessions_refresh_token_hash_uq ON sessions (refresh_token_hash);
    -- Reuse detection revokes a whole family in one UPDATE.
    CREATE INDEX sessions_family_idx ON sessions (family_id);
    -- The "active sessions" screen and "log out everywhere" list a user's live sessions.
    CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
    -- Deleting old sessions sets rotated_from to NULL on their successors, which needs this lookup.
    CREATE INDEX sessions_rotated_from_idx ON sessions (rotated_from) WHERE rotated_from IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE sessions, devices, user_settings, users;
    DROP TYPE session_revoke_reason, device_platform, privacy_level, user_status;
  `.execute(db);
}
