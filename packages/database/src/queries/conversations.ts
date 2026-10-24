import { sql, type Kysely } from 'kysely';

import type { Database } from '../types.js';

class PairExists extends Error {}

// Returns the direct conversation between two users, creating it if needed. If two requests
// create it at the same moment, the direct_pairs primary key lets only one insert win; the
// loser rolls back (discarding its new conversation) and returns the winner's.
export async function findOrCreateDirectConversation(
  db: Kysely<Database>,
  userA: string,
  userB: string,
): Promise<{ conversationId: string; created: boolean }> {
  if (userA === userB) throw new RangeError('a direct conversation needs two different users');
  // Lower-case hex string order matches Postgres uuid order, so this satisfies user_lo < user_hi.
  const [lo, hi] = [userA.toLowerCase(), userB.toLowerCase()].sort() as [string, string];
  const find = () =>
    db
      .selectFrom('direct_pairs')
      .select('conversation_id')
      .where('user_lo', '=', lo)
      .where('user_hi', '=', hi)
      .executeTakeFirst();

  const existing = await find();
  if (existing) return { conversationId: existing.conversation_id, created: false };

  try {
    const conversationId = await db.transaction().execute(async (trx) => {
      const conv = await trx
        .insertInto('conversations')
        .values({ type: 'direct', created_by: userA })
        .returning('id')
        .executeTakeFirstOrThrow();
      const pair = await trx
        .insertInto('direct_pairs')
        .values({ user_lo: lo, user_hi: hi, conversation_id: conv.id })
        .onConflict((oc) => oc.columns(['user_lo', 'user_hi']).doNothing())
        .returning('conversation_id')
        .executeTakeFirst();
      if (!pair) throw new PairExists();
      await trx
        .insertInto('conversation_members')
        .values([
          { conversation_id: conv.id, user_id: lo },
          { conversation_id: conv.id, user_id: hi },
        ])
        .execute();
      return conv.id;
    });
    return { conversationId, created: true };
  } catch (err) {
    if (!(err instanceof PairExists)) throw err;
  }
  const winner = await find();
  return { conversationId: winner!.conversation_id, created: false };
}

// Returns the user's "Saved messages" chat (a chat with themselves), creating it the first time.
// saved_for is UNIQUE, so if two requests race only one insert wins; the other finds that row.
export async function findOrCreateSavedConversation(
  db: Kysely<Database>,
  userId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const find = () =>
    db.selectFrom('conversations').select('id').where('saved_for', '=', userId).executeTakeFirst();

  const existing = await find();
  if (existing) return { conversationId: existing.id, created: false };

  const newId = await db.transaction().execute(async (trx) => {
    const conv = await trx
      .insertInto('conversations')
      .values({ type: 'direct', created_by: userId, saved_for: userId })
      .onConflict((oc) => oc.column('saved_for').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!conv) return null; // lost the race: the winner's row is committed by now
    await trx
      .insertInto('conversation_members')
      .values({ conversation_id: conv.id, user_id: userId })
      .execute();
    return conv.id;
  });
  if (newId) return { conversationId: newId, created: true };
  return { conversationId: (await find())!.id, created: false };
}

// The chat list for one user, most recent activity first, with unread counts computed from the
// cursors (last_seq - read_seq) instead of counting messages. There is no index on
// last_message_at on purpose: it changes on every message, and the sort only covers one
// user's chats, which is a small set.
export function buildChatListQuery(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('conversation_members as cm')
    .innerJoin('conversations as c', 'c.id', 'cm.conversation_id')
    .select([
      'c.id',
      'c.type',
      'c.name',
      'c.avatar_object_key',
      'c.last_seq',
      'c.last_message_at',
      'cm.role',
      'cm.read_seq',
      'cm.muted_until',
      'cm.archived',
      'cm.pinned_at',
      'cm.favourite',
      sql<number>`c.last_seq - cm.read_seq`.as('unread_count'),
    ])
    .where('cm.user_id', '=', userId)
    .where('cm.left_at', 'is', null)
    .orderBy(sql`COALESCE(c.last_message_at, c.created_at)`, 'desc')
    .limit(1000);
}
