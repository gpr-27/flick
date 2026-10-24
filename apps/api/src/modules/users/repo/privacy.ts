import type { PrivacySettings, UpdatePrivacyRequest } from '@chat/contracts';
import type { z } from 'zod';
import type { Db } from '../../../db.js';

type Settings = z.infer<typeof PrivacySettings>;

const toSettings = (
  row: {
    last_seen_privacy: string;
    photo_privacy: string;
    about_privacy: string;
    read_receipts: boolean;
  } | null,
): Settings => ({
  // A missing row (never created) means the defaults. "contacts" is not offered any more.
  last_seen: row?.last_seen_privacy === 'nobody' ? 'nobody' : 'everyone',
  profile_photo: row?.photo_privacy === 'nobody' ? 'nobody' : 'everyone',
  about: row?.about_privacy === 'nobody' ? 'nobody' : 'everyone',
  read_receipts: row?.read_receipts ?? true,
});

export async function getPrivacy(db: Db, userId: string): Promise<Settings> {
  const row = await db
    .selectFrom('user_settings')
    .select(['last_seen_privacy', 'photo_privacy', 'about_privacy', 'read_receipts'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return toSettings(row ?? null);
}

export async function updatePrivacy(
  db: Db,
  userId: string,
  changes: z.infer<typeof UpdatePrivacyRequest>,
): Promise<Settings> {
  const columns = {
    ...(changes.last_seen && { last_seen_privacy: changes.last_seen }),
    ...(changes.profile_photo && { photo_privacy: changes.profile_photo }),
    ...(changes.about && { about_privacy: changes.about }),
    ...(changes.read_receipts !== undefined && { read_receipts: changes.read_receipts }),
  };
  if (Object.keys(columns).length === 0) return getPrivacy(db, userId);
  // The row normally exists since sign-up; upsert so a missing one is created.
  const row = await db
    .insertInto('user_settings')
    .values({ user_id: userId, ...columns })
    .onConflict((oc) => oc.column('user_id').doUpdateSet(columns))
    .returning(['last_seen_privacy', 'photo_privacy', 'about_privacy', 'read_receipts'])
    .executeTakeFirstOrThrow();
  return toSettings(row);
}

/** A user as another person may see them, or undefined when they do not exist or blocked the viewer. */
export async function findProfile(db: Db, viewerId: string, userId: string) {
  return db
    .selectFrom('users as u')
    .leftJoin('user_settings as s', 's.user_id', 'u.id')
    .select([
      'u.id',
      'u.username',
      'u.display_name',
      'u.about',
      'u.avatar_object_key',
      'u.avatar_url',
      'u.is_bot',
      'u.last_seen_at',
      's.last_seen_privacy',
      's.photo_privacy',
      's.about_privacy',
    ])
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom('blocks')
            .select('blocks.blocker_id')
            .where('blocks.blocker_id', '=', viewerId)
            .where('blocks.blocked_id', '=', userId),
        )
        .as('blocked_by_me'),
    )
    .where('u.id', '=', userId)
    .where('u.status', '=', 'active')
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks')
            .select('blocks.blocker_id')
            .where('blocks.blocker_id', '=', userId)
            .where('blocks.blocked_id', '=', viewerId),
        ),
      ),
    )
    .executeTakeFirst();
}
