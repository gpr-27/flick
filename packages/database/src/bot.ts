import type { Kysely } from 'kysely';

import type { Database } from './types.js';

// The "@flick" AI assistant user, created by migration 0001_identity.
export const FLICK_BOT_USER_ID = '00000000-0000-4000-8000-00000000f11c';

// Re-creates the bot user (the seed empties the users table first). Same values as the migration.
export async function ensureFlickBot(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('users')
    .values({
      id: FLICK_BOT_USER_ID,
      username: 'flick',
      display_name: 'Flick',
      about: 'Your AI assistant. Mention @flick to ask me anything.',
      is_bot: true,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}
