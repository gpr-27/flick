// Invite links and the join-request queue. Like groups.ts, each change is one transaction.
import { LIMITS } from '@chat/contracts';
import { sql } from 'kysely';
import { mediaUrl } from '../../../avatars.js';
import type { Config } from '../../../config.js';
import type { Db } from '../../../db.js';
import { hashInviteCode, newInviteCode } from '../domain/invite-code.js';
import { canManageMembers, hasGroupFeatures } from '../domain/roles.js';
import { ApiError, forbidden } from '../http/errors.js';
import {
  type Q,
  USER_COLUMNS,
  announce,
  findActiveMember,
  insertMember,
  lockConversation,
  requireActiveMember,
  toUserSummary,
} from './core.js';
import { decodeCursor, encodeCursor } from './cursor.js';

const invalidInvite = () => new ApiError('INVITE_INVALID', 'This invite link is not valid');

export async function createInvite(
  db: Db,
  actorId: string,
  conversationId: string,
  input: { expiresInS?: number; maxUses?: number },
) {
  const actor = await requireActiveMember(db, conversationId, actorId);
  const conv = await db
    .selectFrom('conversations')
    .select(['type', 'approval_required'])
    .where('id', '=', conversationId)
    .executeTakeFirstOrThrow();
  if (!hasGroupFeatures(conv.type)) throw forbidden('Direct chats have no invite links');
  if (!canManageMembers(actor.role)) throw forbidden('Only admins can create invite links');

  const code = newInviteCode();
  const expiresAt = input.expiresInS ? new Date(Date.now() + input.expiresInS * 1000) : null;
  await db
    .insertInto('invite_links')
    .values({
      conversation_id: conversationId,
      created_by: actorId,
      token_hash: hashInviteCode(code),
      expires_at: expiresAt,
      max_uses: input.maxUses ?? null,
      requires_approval: conv.approval_required,
    })
    .execute();
  return { code, conversation_id: conversationId, expires_at: expiresAt?.toISOString() ?? null };
}

/** The link if it can still be used: not revoked, not expired, not used up. */
const usable = sql<boolean>`il.revoked_at IS NULL
  AND (il.expires_at IS NULL OR il.expires_at > now())
  AND (il.max_uses IS NULL OR il.use_count < il.max_uses)`;

export async function previewInvite(db: Db, config: Config, code: string) {
  const row = await db
    .selectFrom('invite_links as il')
    .innerJoin('conversations as c', 'c.id', 'il.conversation_id')
    .select(['c.id', 'c.name', 'c.avatar_object_key', 'c.approval_required'])
    .where('il.token_hash', '=', hashInviteCode(code))
    .where(usable)
    .executeTakeFirst();
  if (!row) throw invalidInvite();
  const count = await db
    .selectFrom('conversation_members')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('conversation_id', '=', row.id)
    .where('left_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    conversation_id: row.id,
    title: row.name ?? '',
    avatar_url: mediaUrl(config, row.avatar_object_key),
    member_count: Number(count.n),
    approval_required: row.approval_required,
  };
}

export async function revokeInvite(db: Db, actorId: string, code: string) {
  const link = await db
    .selectFrom('invite_links')
    .select(['id', 'conversation_id'])
    .where('token_hash', '=', hashInviteCode(code))
    .executeTakeFirst();
  if (!link) throw invalidInvite();
  const actor = await findActiveMember(db, link.conversation_id, actorId);
  if (!actor) throw invalidInvite(); // outsiders cannot tell the link exists
  if (!canManageMembers(actor.role)) throw forbidden('Only admins can revoke invite links');
  await db
    .updateTable('invite_links')
    .set({ revoked_at: new Date() })
    .where('id', '=', link.id)
    .where('revoked_at', 'is', null)
    .execute();
}

/**
 * Join through a link. Every use of the link counts, including one that only creates a join
 * request (a rejected request does not give the use back). The count is bumped by a single
 * UPDATE with the limits in its WHERE, so two people cannot take the last use together.
 */
export async function joinByInvite(db: Db, userId: string, code: string) {
  return db.transaction().execute(async (trx) => {
    const link = await trx
      .selectFrom('invite_links')
      .select(['id', 'conversation_id'])
      .where('token_hash', '=', hashInviteCode(code))
      .executeTakeFirst();
    if (!link) throw invalidInvite();
    const conv = await lockConversation(trx, link.conversation_id);

    if (await findActiveMember(trx, conv.id, userId)) {
      return { status: 'joined' as const, conversation_id: conv.id };
    }
    const used = await trx
      .updateTable('invite_links as il')
      .set((eb) => ({ use_count: eb('il.use_count', '+', 1) }))
      .where('il.id', '=', link.id)
      .where(usable)
      .returning('il.id')
      .executeTakeFirst();
    if (!used) throw invalidInvite();

    if (conv.approval_required) {
      const pending = await trx
        .selectFrom('join_requests')
        .select('id')
        .where('conversation_id', '=', conv.id)
        .where('user_id', '=', userId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!pending) {
        await trx
          .insertInto('join_requests')
          .values({ conversation_id: conv.id, user_id: userId })
          .execute();
      }
      return { status: 'requested' as const, conversation_id: conv.id };
    }

    await addJoiner(trx, conv, userId);
    return { status: 'joined' as const, conversation_id: conv.id };
  });
}

async function addJoiner(
  trx: Q,
  conv: Awaited<ReturnType<typeof lockConversation>>,
  userId: string,
) {
  const count = await trx
    .selectFrom('conversation_members')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('conversation_id', '=', conv.id)
    .where('left_at', 'is', null)
    .executeTakeFirstOrThrow();
  if (Number(count.n) >= LIMITS.MAX_GROUP_MEMBERS) {
    throw new ApiError('GROUP_FULL', 'This group is full');
  }
  await insertMember(trx, conv, userId);
  // Nobody added them, so there is no actor.
  await announce(
    trx,
    conv.id,
    { event: 'member_added', actor: null, targets: [userId] },
    { type: 'conversation.members_added', data: { actor_user_id: null, user_ids: [userId] } },
  );
}

// ------------------------------------------------------------ join requests

/** Pending requests, oldest first. The cursor is "created_at|id" of the last row. */
export async function listJoinRequests(
  db: Db,
  config: Config,
  actorId: string,
  conversationId: string,
  query: { cursor?: string; limit: number },
) {
  const actor = await requireActiveMember(db, conversationId, actorId);
  if (!canManageMembers(actor.role)) throw forbidden('Only admins can see join requests');

  const after = query.cursor ? decodeCursor(query.cursor).split('|') : null;
  if (after && after.length !== 2) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
  const rows = await db
    .selectFrom('join_requests as jr')
    .innerJoin('users as u', 'u.id', 'jr.user_id')
    // created_at::text keeps microseconds, which a JavaScript Date would round off.
    .select([
      ...USER_COLUMNS,
      'jr.id as request_id',
      sql<string>`jr.created_at::text`.as('created_text'),
      'jr.created_at',
    ])
    .where('jr.conversation_id', '=', conversationId)
    .where('jr.status', '=', 'pending')
    .$if(after !== null, (qb) =>
      qb.where(
        sql<boolean>`(jr.created_at, jr.id) > (${after![0]}::timestamptz, ${after![1]}::uuid)`,
      ),
    )
    .orderBy('jr.created_at')
    .orderBy('jr.id')
    .limit(query.limit + 1)
    .execute();
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.request_id,
      user: toUserSummary(config, r),
      created_at: r.created_at.toISOString(),
    })),
    next_cursor:
      rows.length > query.limit && last
        ? encodeCursor(`${last.created_text}|${last.request_id}`)
        : null,
  };
}

export async function decideJoinRequest(
  db: Db,
  actorId: string,
  conversationId: string,
  requestId: string,
  approve: boolean,
) {
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const actor = await requireActiveMember(trx, conversationId, actorId);
    if (!canManageMembers(actor.role)) throw forbidden('Only admins can decide join requests');

    const request = await trx
      .updateTable('join_requests')
      .set({
        status: approve ? 'approved' : 'rejected',
        decided_at: new Date(),
        decided_by: actorId,
      })
      .where('id', '=', requestId)
      .where('conversation_id', '=', conversationId)
      .where('status', '=', 'pending')
      .returning('user_id')
      .executeTakeFirst();
    if (!request) throw new ApiError('NOT_FOUND', 'Join request not found');

    if (approve && !(await findActiveMember(trx, conversationId, request.user_id))) {
      await addJoiner(trx, conv, request.user_id);
    }
  });
}
