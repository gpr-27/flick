import type { User } from '@chat/db';
import { sql } from 'kysely';
import type { Db } from '../../../db.js';

export const findUserById = (db: Db, id: string): Promise<User | undefined> =>
  db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();

export interface ProfileChanges {
  display_name?: string;
  username?: string;
  about?: string | null;
  avatar_object_key?: string | null;
}

export async function updateProfile(db: Db, userId: string, changes: ProfileChanges) {
  return db
    .updateTable('users')
    .set({ ...changes, updated_at: sql`now()` })
    .where('id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** An uploaded avatar image the user owns, or undefined. Marks it as in use. */
export async function claimAvatarAttachment(db: Db, userId: string, attachmentId: string) {
  return db
    .updateTable('attachments')
    .set({ status: 'attached' })
    .where('id', '=', attachmentId)
    .where('owner_id', '=', userId)
    .where('status', 'in', ['uploaded', 'attached'])
    .returning('object_key')
    .executeTakeFirst();
}

// "%" and "_" typed by the user must match themselves, not act as wildcards.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * People search by username or display name. Best matches first: exact username, then
 * username prefix, then everything else alphabetically. Never returns the caller, inactive
 * accounts, or people who blocked the caller (so a blocked person cannot find them again).
 */
export async function searchUsers(db: Db, callerId: string, query: string, limit: number) {
  const exact = query.toLowerCase();
  const prefix = `${escapeLike(query)}%`;
  const anywhere = `%${escapeLike(query)}%`;
  return db
    .selectFrom('users')
    .select(['id', 'username', 'display_name', 'avatar_object_key', 'avatar_url', 'is_bot'])
    .where('id', '!=', callerId)
    .where('status', '=', 'active')
    .where((eb) => eb.or([eb('username', 'ilike', prefix), eb('display_name', 'ilike', anywhere)]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks')
            .select('blocks.blocker_id')
            .whereRef('blocks.blocker_id', '=', 'users.id')
            .where('blocks.blocked_id', '=', callerId),
        ),
      ),
    )
    .orderBy(sql`(username = ${exact})`, 'desc')
    .orderBy(sql`(username ILIKE ${prefix})`, 'desc')
    .orderBy('display_name')
    .limit(limit)
    .execute();
}
