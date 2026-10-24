import { sql } from 'kysely';
import type { Db } from '../../../db.js';

/** Blocking twice is fine: the second call changes nothing. */
export async function blockUser(db: Db, blockerId: string, blockedId: string) {
  await db
    .insertInto('blocks')
    .values({ blocker_id: blockerId, blocked_id: blockedId })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export async function unblockUser(db: Db, blockerId: string, blockedId: string) {
  await db
    .deleteFrom('blocks')
    .where('blocker_id', '=', blockerId)
    .where('blocked_id', '=', blockedId)
    .execute();
}

export async function userExists(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', userId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row !== undefined;
}

/** Newest first. The page boundary is (blocked_at, blocked_id), which is unique. */
export async function listBlocks(
  db: Db,
  blockerId: string,
  limit: number,
  after: { blockedAt: string; blockedId: string } | null,
) {
  let query = db
    .selectFrom('blocks')
    .innerJoin('users', 'users.id', 'blocks.blocked_id')
    .select([
      'users.id',
      'users.username',
      'users.display_name',
      'users.avatar_object_key',
      'users.avatar_url',
      'users.is_bot',
      'blocks.created_at as blocked_at',
      // Postgres keeps microseconds, a JS Date only milliseconds: the cursor uses the exact text.
      sql<string>`blocks.created_at::text`.as('blocked_at_text'),
    ])
    .where('blocks.blocker_id', '=', blockerId);
  if (after) {
    query = query.where(
      sql<boolean>`(blocks.created_at, blocks.blocked_id) < (${after.blockedAt}::timestamptz, ${after.blockedId}::uuid)`,
    );
  }
  return query
    .orderBy('blocks.created_at', 'desc')
    .orderBy('blocks.blocked_id', 'desc')
    .limit(limit + 1) // one extra row tells us whether there is a next page
    .execute();
}

/**
 * Stores a report. For a message, the reporter must be an active member of its conversation, and
 * a copy of the text is kept as evidence in case the sender deletes it later.
 */
export async function createReport(
  db: Db,
  reporterId: string,
  input: {
    userId?: string;
    conversationId?: string;
    messageId?: string;
    reason: string;
    details?: string;
  },
): Promise<{ reportId: string; reportedUserId: string | null } | null> {
  let reportedUserId = input.userId ?? null;
  const evidence: object[] = [];
  if (input.conversationId && input.messageId) {
    const message = await db
      .selectFrom('messages as m')
      .innerJoin('conversation_members as cm', (join) =>
        join
          .onRef('cm.conversation_id', '=', 'm.conversation_id')
          .on('cm.user_id', '=', reporterId),
      )
      .select(['m.id', 'm.sender_id', 'm.body_text', 'm.created_at'])
      .where('m.id', '=', input.messageId)
      .where('m.conversation_id', '=', input.conversationId)
      .where('cm.left_at', 'is', null)
      .executeTakeFirst();
    if (!message) return null;
    reportedUserId ??= message.sender_id;
    evidence.push({
      message_id: message.id,
      sender_id: message.sender_id,
      text: message.body_text,
      created_at: message.created_at,
    });
  }
  if (input.details) evidence.push({ details: input.details });
  const row = await db
    .insertInto('reports')
    .values({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      conversation_id: input.conversationId ?? null,
      reason: input.reason,
      evidence: JSON.stringify(evidence),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { reportId: row.id, reportedUserId };
}
