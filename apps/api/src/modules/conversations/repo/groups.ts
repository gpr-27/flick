// Every function here changes membership or settings in ONE transaction that also writes the
// system message and the outbox event (see announce). If any step fails, nothing is kept.
import { LIMITS, type MemberRole } from '@chat/contracts';
import {
  type ConversationsTable,
  findOrCreateDirectConversation,
  findOrCreateSavedConversation,
} from '@chat/db';
import type { Updateable } from 'kysely';
import type { Db } from '../../../db.js';
import {
  canChangeRole,
  canChangeSettings,
  canEditInfo,
  canManageMembers,
  canRemove,
  hasGroupFeatures,
  nextOwner,
} from '../domain/roles.js';
import { ApiError, forbidden } from '../http/errors.js';
import {
  type ConversationRow,
  type Q,
  announce,
  findActiveMember,
  insertMember,
  lockConversation,
  requireActiveMember,
} from './core.js';

// ------------------------------------------------------------------- direct

/** True if either user has blocked the other. */
export async function isBlockedPair(q: Q, a: string, b: string): Promise<boolean> {
  const row = await q
    .selectFrom('blocks')
    .select('blocker_id')
    .where((eb) =>
      eb.or([
        eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]),
        eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)]),
      ]),
    )
    .executeTakeFirst();
  return row !== undefined;
}

export async function openDirect(db: Db, userId: string, otherId: string): Promise<string> {
  if (userId === otherId) throw new ApiError('VALIDATION_FAILED', 'Cannot chat with yourself');
  const other = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', otherId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!other) throw new ApiError('NOT_FOUND', 'User not found');
  if (await isBlockedPair(db, userId, otherId)) {
    throw new ApiError('BLOCKED', 'You cannot message this user');
  }

  const { conversationId, created } = await findOrCreateDirectConversation(db, userId, otherId);
  // A chat you deleted for yourself is still the same chat: starting it again brings it back to
  // your list. Its old messages stay hidden (they were cleared), so it opens empty.
  await db
    .updateTable('conversation_members')
    .set({ deleted_at: null })
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is not', null)
    .execute();
  if (created) {
    // The helper owns its transaction, so this event is a separate write. If it were lost the
    // other user would still learn of the chat from the first message.
    await announce(db, conversationId, null, {
      type: 'conversation.created',
      data: { created_by: userId, member_ids: [userId, otherId] },
    });
  }
  return conversationId;
}

/** The caller's "Saved messages" chat. Only they are in it, so there is nobody to announce it to. */
export async function openSaved(db: Db, userId: string): Promise<string> {
  const { conversationId } = await findOrCreateSavedConversation(db, userId);
  return conversationId;
}

// -------------------------------------------------------------------- group

/** Splits `userIds` into those who can be added and those who cannot, with a reason for each. */
async function checkAddable(
  trx: Q,
  actorId: string,
  conv: ConversationRow | null,
  userIds: string[],
) {
  const failed: { user_id: string; code: string }[] = [];
  const unique = [...new Set(userIds)].filter((id) => id !== actorId);

  const existing = new Set(
    (
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', 'in', unique)
        .where('status', '=', 'active')
        .execute()
    ).map((u) => u.id),
  );
  const blocked = new Set(
    (
      await trx
        .selectFrom('blocks')
        .select(['blocker_id', 'blocked_id'])
        .where((eb) =>
          eb.or([
            eb.and([eb('blocker_id', '=', actorId), eb('blocked_id', 'in', unique)]),
            eb.and([eb('blocked_id', '=', actorId), eb('blocker_id', 'in', unique)]),
          ]),
        )
        .execute()
    ).map((b) => (b.blocker_id === actorId ? b.blocked_id : b.blocker_id)),
  );
  // People who chose "Who can add me to groups: nobody" can only join by an invite link.
  const refuseAdds = new Set(
    (
      await trx
        .selectFrom('user_settings')
        .select('user_id')
        .where('user_id', 'in', unique)
        .where('groups_add_privacy', '=', 'nobody')
        .execute()
    ).map((r) => r.user_id),
  );
  const members = conv
    ? await trx
        .selectFrom('conversation_members')
        .select('user_id')
        .where('conversation_id', '=', conv.id)
        .where('left_at', 'is', null)
        .execute()
    : [];
  const alreadyIn = new Set(members.map((m) => m.user_id));

  const ok: string[] = [];
  for (const id of unique) {
    if (!existing.has(id)) failed.push({ user_id: id, code: 'NOT_FOUND' });
    else if (blocked.has(id)) failed.push({ user_id: id, code: 'BLOCKED' });
    else if (refuseAdds.has(id)) failed.push({ user_id: id, code: 'FORBIDDEN' });
    else if (alreadyIn.has(id)) failed.push({ user_id: id, code: 'CONFLICT' });
    else if (ok.length + alreadyIn.size >= LIMITS.MAX_GROUP_MEMBERS) {
      failed.push({ user_id: id, code: 'GROUP_FULL' });
    } else ok.push(id);
  }
  return { ok, failed };
}

async function attachmentKey(trx: Q, ownerId: string, attachmentId: string): Promise<string> {
  const attachment = await trx
    .updateTable('attachments')
    .set({ status: 'attached' })
    .where('id', '=', attachmentId)
    .where('owner_id', '=', ownerId)
    .where('status', 'in', ['uploaded', 'attached'])
    .returning('object_key')
    .executeTakeFirst();
  if (!attachment) throw new ApiError('NOT_FOUND', 'Avatar upload not found');
  return attachment.object_key;
}

export async function createGroup(
  db: Db,
  userId: string,
  input: { title: string; memberIds: string[]; avatarAttachmentId?: string },
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const avatarKey = input.avatarAttachmentId
      ? await attachmentKey(trx, userId, input.avatarAttachmentId)
      : null;
    const created = await trx
      .insertInto('conversations')
      .values({
        type: 'group',
        name: input.title,
        avatar_object_key: avatarKey,
        created_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const { ok } = await checkAddable(trx, userId, null, input.memberIds);
    await insertMember(trx, created, userId, 'owner');
    for (const id of ok) await insertMember(trx, created, id);

    await announce(
      trx,
      created.id,
      { event: 'group_created', actor: userId, targets: ok },
      { type: 'conversation.created', data: { created_by: userId, member_ids: [userId, ...ok] } },
    );
    return created.id;
  });
}

export async function addMembers(
  db: Db,
  actorId: string,
  conversationId: string,
  userIds: string[],
) {
  return db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const actor = await requireActiveMember(trx, conversationId, actorId);
    if (!hasGroupFeatures(conv.type)) throw forbidden('Direct chats have no members to add');
    if (!canManageMembers(actor.role)) throw forbidden('Only admins can add members');

    const { ok, failed } = await checkAddable(trx, actorId, conv, userIds);
    for (const id of ok) await insertMember(trx, conv, id);
    if (ok.length > 0) {
      await announce(
        trx,
        conversationId,
        { event: 'member_added', actor: actorId, targets: ok },
        { type: 'conversation.members_added', data: { actor_user_id: actorId, user_ids: ok } },
      );
    }
    return { added: ok, failed };
  });
}

/** Marks the member as gone. The row stays so their old messages keep a sender. */
async function markLeft(trx: Q, conversationId: string, userId: string) {
  await trx
    .updateTable('conversation_members')
    .set({ left_at: new Date(), pinned_at: null })
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .execute();
}

export async function removeMember(
  db: Db,
  actorId: string,
  conversationId: string,
  targetId: string,
) {
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const actor = await requireActiveMember(trx, conversationId, actorId);
    if (!hasGroupFeatures(conv.type)) throw forbidden('Direct chats have no members to remove');
    const target = await findActiveMember(trx, conversationId, targetId);
    if (!target) throw new ApiError('NOT_FOUND', 'Member not found');
    if (!canRemove(actor.role, target.role)) throw forbidden('You cannot remove this member');

    await markLeft(trx, conversationId, targetId);
    await announce(
      trx,
      conversationId,
      { event: 'member_removed', actor: actorId, targets: [targetId] },
      { type: 'conversation.member_removed', data: { actor_user_id: actorId, user_id: targetId } },
    );
  });
}

export async function leaveGroup(db: Db, userId: string, conversationId: string) {
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const me = await requireActiveMember(trx, conversationId, userId);
    if (!hasGroupFeatures(conv.type)) throw forbidden('You cannot leave a direct chat');

    if (me.role === 'owner') {
      const others = (
        await trx
          .selectFrom('conversation_members')
          .select(['user_id', 'role', 'joined_at'])
          .where('conversation_id', '=', conversationId)
          .where('left_at', 'is', null)
          .where('user_id', '!=', userId)
          .execute()
      ).map((m) => ({ userId: m.user_id, role: m.role, joinedAt: m.joined_at }));
      const heir = nextOwner(others);
      if (heir) {
        await trx
          .updateTable('conversation_members')
          .set({ role: 'owner' })
          .where('conversation_id', '=', conversationId)
          .where('user_id', '=', heir)
          .execute();
        await announce(trx, conversationId, null, {
          type: 'conversation.role_changed',
          data: { actor_user_id: userId, user_id: heir, role: 'owner' },
        });
      }
    }

    await markLeft(trx, conversationId, userId);
    await announce(
      trx,
      conversationId,
      { event: 'member_left', actor: userId, targets: [userId] },
      { type: 'conversation.member_removed', data: { actor_user_id: userId, user_id: userId } },
    );
  });
}

export async function setRole(
  db: Db,
  actorId: string,
  conversationId: string,
  targetId: string,
  newRole: MemberRole,
) {
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const actor = await requireActiveMember(trx, conversationId, actorId);
    if (!hasGroupFeatures(conv.type)) throw forbidden('Direct chats have no roles');
    const target = await findActiveMember(trx, conversationId, targetId);
    if (!target) throw new ApiError('NOT_FOUND', 'Member not found');
    if (!canChangeRole(actor.role, target.role, newRole)) {
      throw forbidden('You cannot change this role');
    }

    await trx
      .updateTable('conversation_members')
      .set({ role: newRole })
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', targetId)
      .execute();
    await announce(
      trx,
      conversationId,
      { event: 'role_changed', actor: actorId, targets: [targetId] },
      {
        type: 'conversation.role_changed',
        data: { actor_user_id: actorId, user_id: targetId, role: newRole },
      },
    );
  });
}

// ----------------------------------------------------------------- settings

export interface UpdateInput {
  title?: string;
  description?: string;
  avatarAttachmentId?: string | null;
  settings?: {
    only_admins_send?: boolean;
    only_admins_edit_info?: boolean;
    approval_required?: boolean;
    disappearing_timer_s?: number;
  };
}

export async function updateConversation(
  db: Db,
  actorId: string,
  conversationId: string,
  input: UpdateInput,
) {
  await db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    const actor = await requireActiveMember(trx, conversationId, actorId);
    const { settings = {} } = input;
    const changesInfo =
      input.title !== undefined ||
      input.description !== undefined ||
      input.avatarAttachmentId !== undefined;
    const { disappearing_timer_s: timer, ...switches } = settings;

    if (!hasGroupFeatures(conv.type)) {
      // A direct chat has only the disappearing timer, and both people may change it.
      if (changesInfo || Object.keys(switches).length > 0) {
        throw forbidden('Only the disappearing timer can be changed in a direct chat');
      }
    } else {
      if (changesInfo && !canEditInfo(actor.role, conv.admin_only_edit)) {
        throw forbidden('Only admins can edit this group');
      }
      if (Object.keys(settings).length > 0 && !canChangeSettings(actor.role)) {
        throw forbidden('Only admins can change group settings');
      }
    }

    const update: Updateable<ConversationsTable> = {};
    if (input.title !== undefined) update.name = input.title;
    if (input.description !== undefined) update.description = input.description || null;
    if (input.avatarAttachmentId !== undefined) {
      update.avatar_object_key = input.avatarAttachmentId
        ? await attachmentKey(trx, actorId, input.avatarAttachmentId)
        : null;
    }
    if (switches.only_admins_send !== undefined) update.admin_only_send = switches.only_admins_send;
    if (switches.only_admins_edit_info !== undefined) {
      update.admin_only_edit = switches.only_admins_edit_info;
    }
    if (switches.approval_required !== undefined) {
      update.approval_required = switches.approval_required;
    }
    if (timer !== undefined) update.disappearing_seconds = timer === 0 ? null : timer;
    if (Object.keys(update).length === 0) return;

    await trx.updateTable('conversations').set(update).where('id', '=', conversationId).execute();

    // Name and timer changes show up in the chat as system messages; the other switches do not.
    const updated = { type: 'conversation.updated', data: { actor_user_id: actorId } };
    const renamed = input.title !== undefined && input.title !== conv.name;
    const timerChanged = timer !== undefined && (timer || null) !== conv.disappearing_seconds;
    if (renamed) {
      await announce(
        trx,
        conversationId,
        { event: 'renamed', actor: actorId, targets: [] },
        updated,
      );
    }
    if (timerChanged) {
      await announce(
        trx,
        conversationId,
        { event: 'timer_changed', actor: actorId, targets: [] },
        updated,
      );
    }
    if (!renamed && !timerChanged) await announce(trx, conversationId, null, updated);
  });
}
