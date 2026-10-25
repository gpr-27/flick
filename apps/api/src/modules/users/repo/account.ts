// Queries behind the profile and settings pages: stats, usernames, data export, account deletion.
import { FLICK_BOT_USER_ID } from '@chat/db';
import { sql } from 'kysely';
import type { Db } from '../../../db.js';

/** Chats, groups, days on Flick and last activity: one round trip. */
export async function getStats(db: Db, userId: string) {
  const { rows } = await sql<{
    chats: number;
    groups: number;
    days: number;
    last_active_at: Date | null;
  }>`
    SELECT
      (SELECT count(*) FROM conversation_members m
        WHERE m.user_id = u.id AND m.left_at IS NULL)::int AS chats,
      (SELECT count(*) FROM conversation_members m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.user_id = u.id AND m.left_at IS NULL AND c.type = 'group')::int AS groups,
      ((now()::date - u.created_at::date) + 1)::int AS days,
      (SELECT max(d.last_active_at) FROM devices d WHERE d.user_id = u.id) AS last_active_at
    FROM users u
    WHERE u.id = ${userId}
  `.execute(db);
  const row = rows[0];
  return row ? { ...row, days: Math.max(1, row.days) } : undefined;
}

/** True when another account already has this username (usernames ignore case). */
export async function usernameTaken(db: Db, username: string, exceptUserId: string) {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('username', '=', username)
    .where('id', '!=', exceptUserId)
    .executeTakeFirst();
  return row !== undefined;
}

/** True when the error is Postgres saying a unique index was violated. */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Closes the account: the profile is wiped (the messages stay and show "Deleted user"), the
 * username and email are freed, and push subscriptions go. The Clerk id stays on the row so a
 * later sign-in with the same Clerk account is refused (403) instead of making a new account.
 */
export async function anonymiseUser(db: Db, userId: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({
        status: 'deleted',
        display_name: 'Deleted user',
        username: `deleted_${userId.replaceAll('-', '').slice(0, 12)}`,
        email: null,
        about: null,
        avatar_object_key: null,
        avatar_url: null,
        updated_at: sql`now()`,
      })
      .where('id', '=', userId)
      .execute();
    await trx.deleteFrom('push_subscriptions').where('user_id', '=', userId).execute();
  });
}

/** "Clear chat" with the assistant, for this user only: every message is hidden from them. */
export async function hideFlickChat(db: Db, userId: string): Promise<void> {
  // direct_pairs keeps the smaller id first.
  const [lo, hi] =
    userId < FLICK_BOT_USER_ID ? [userId, FLICK_BOT_USER_ID] : [FLICK_BOT_USER_ID, userId];
  await sql`
    INSERT INTO hidden_messages (user_id, message_id)
    SELECT ${userId}::uuid, m.id
    FROM direct_pairs p
    JOIN messages m ON m.conversation_id = p.conversation_id
    WHERE p.user_lo = ${lo}::uuid AND p.user_hi = ${hi}::uuid
    ON CONFLICT DO NOTHING
  `.execute(db);
}

// ------------------------------------------------------------------- export

const PAGE = 500;

/**
 * The caller's data as JSON text, in pieces. Only the caller's profile, their active chats and
 * the messages they can see (not ones they deleted for themselves). Messages are read 500 at a
 * time in `seq` order, so memory stays flat however much history there is.
 */
export async function* exportChunks(db: Db, userId: string): AsyncGenerator<string> {
  const me = await db
    .selectFrom('users')
    .select(['id', 'username', 'email', 'display_name', 'about', 'created_at'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const chats = await db
    .selectFrom('conversation_members as cm')
    .innerJoin('conversations as c', 'c.id', 'cm.conversation_id')
    .select(['c.id', 'c.type', 'c.name', 'cm.joined_at'])
    .where('cm.user_id', '=', userId)
    .where('cm.left_at', 'is', null)
    .orderBy('cm.joined_at')
    .execute();

  yield `{"exported_at":${JSON.stringify(new Date().toISOString())},"profile":${JSON.stringify(me)},"chats":[`;
  let firstChat = true;
  for (const chat of chats) {
    const members = await db
      .selectFrom('conversation_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['u.id', 'u.username', 'u.display_name'])
      .where('cm.conversation_id', '=', chat.id)
      .where('cm.left_at', 'is', null)
      .execute();
    yield `${firstChat ? '' : ','}{"id":${JSON.stringify(chat.id)},"type":${JSON.stringify(chat.type)},"name":${JSON.stringify(chat.name)},"members":${JSON.stringify(members)},"messages":[`;
    firstChat = false;

    let afterSeq = 0;
    let firstMessage = true;
    for (;;) {
      const rows = await db
        .selectFrom('messages as m')
        .select([
          'm.id',
          'm.seq',
          'm.sender_id',
          'm.type',
          'm.body_text',
          'm.content',
          'm.created_at',
          'm.edited_at',
        ])
        .where('m.conversation_id', '=', chat.id)
        .where('m.seq', '>', afterSeq)
        .where('m.deleted_at', 'is', null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('hidden_messages as h')
                .select('h.message_id')
                .whereRef('h.message_id', '=', 'm.id')
                .where('h.user_id', '=', userId),
            ),
          ),
        )
        .orderBy('m.seq')
        .limit(PAGE)
        .execute();
      if (rows.length === 0) break;
      yield (firstMessage ? '' : ',') + rows.map((r) => JSON.stringify(r)).join(',');
      firstMessage = false;
      afterSeq = rows[rows.length - 1]!.seq;
      if (rows.length < PAGE) break;
    }
    yield ']}';
  }
  yield ']}';
}
