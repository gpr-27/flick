import { randomUUID } from 'node:crypto';
import { ConversationEvent, TOPICS, type MemberRole, type UserSummary } from '@chat/contracts';
import { allocateSeqAndInsertMessage } from '@chat/db';
import { userAvatarUrl } from '../../../avatars.js';
import type { Config } from '../../../config.js';
import type { Db } from '../../../db.js';
import { notFound } from '../http/errors.js';

/** A Db or a transaction: both have the same query methods. */
export type Q = Db;

export interface MemberRow {
  role: MemberRole;
  joined_at: Date;
}

/**
 * Role of an ACTIVE member, or undefined. This reads Postgres every time and never a cache,
 * so a removed member loses access on their very next request. Every route that returns
 * conversation data (here and in the messages module) must go through this check.
 */
export async function findActiveMember(
  q: Q,
  conversationId: string,
  userId: string,
): Promise<MemberRow | undefined> {
  return q
    .selectFrom('conversation_members')
    .select(['role', 'joined_at'])
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
}

/** Like findActiveMember, but a non-member gets the same 404 as a missing conversation. */
export async function requireActiveMember(
  q: Q,
  conversationId: string,
  userId: string,
): Promise<MemberRow> {
  const member = await findActiveMember(q, conversationId, userId);
  if (!member) throw notFound();
  return member;
}

/**
 * Locks the conversation row for the rest of the transaction. Membership changes, settings
 * changes and new messages all update this row, so they run one at a time per conversation.
 * That keeps rules such as "the owner leaves" or "the group is full" free of races.
 */
export async function lockConversation(q: Q, conversationId: string) {
  const conv = await q
    .selectFrom('conversations')
    .selectAll()
    .where('id', '=', conversationId)
    .forUpdate()
    .executeTakeFirst();
  if (!conv) throw notFound();
  return conv;
}
export type ConversationRow = Awaited<ReturnType<typeof lockConversation>>;

type SystemEvent =
  | 'group_created'
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'role_changed'
  | 'renamed'
  | 'timer_changed';

/**
 * Called inside the transaction that changes the conversation. It adds:
 *  - a `system` message ("Alice added Bob"). It takes a sequence number and goes through the
 *    outbox like any message, so every device sees it in order and sync catches it up;
 *  - a chat.conversation.v1 event for the other members' clients (new member list, new settings).
 * Both rows commit or roll back together with the change.
 */
export async function announce(
  trx: Q,
  conversationId: string,
  system: { event: SystemEvent; actor: string | null; targets: string[] } | null,
  event: { type: string; data: Record<string, unknown> },
): Promise<void> {
  if (system) {
    await allocateSeqAndInsertMessage(trx, {
      conversationId,
      senderId: null,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'system',
      content: {
        type: 'system',
        event: system.event,
        actor_user_id: system.actor,
        target_user_ids: system.targets,
      },
      authorize: false,
    });
  }
  // Parsing here means a malformed event fails the transaction instead of reaching Redpanda.
  const parsed = ConversationEvent.parse({
    event_id: randomUUID(),
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    key: conversationId,
    type: event.type,
    conversation_id: conversationId,
    data: event.data,
  });
  await trx
    .insertInto('outbox')
    .values({
      event_id: parsed.event_id,
      topic: TOPICS.CONVERSATION,
      partition_key: conversationId,
      payload: parsed,
    })
    .execute();
}

/** Adds a user to the group, or brings back a user who left. Their old chat prefs are reset. */
export async function insertMember(
  trx: Q,
  conv: ConversationRow,
  userId: string,
  role: MemberRole = 'member',
): Promise<void> {
  await trx
    .insertInto('conversation_members')
    .values({
      conversation_id: conv.id,
      user_id: userId,
      role,
      // Someone who joins late has nothing unread from before they joined.
      read_seq: conv.last_seq,
    })
    .onConflict((oc) =>
      oc.columns(['conversation_id', 'user_id']).doUpdateSet({
        role,
        left_at: null,
        joined_at: new Date(),
        read_seq: conv.last_seq,
        muted_until: null,
        archived: false,
        pinned_at: null,
        favourite: false,
        wallpaper: null,
        lock_hash: null,
        deleted_at: null,
        marked_unread: false,
      }),
    )
    .execute();
}

interface UserColumns {
  id: string;
  username: string;
  display_name: string;
  avatar_object_key: string | null;
  avatar_url: string | null;
  is_bot: boolean;
}
export const USER_COLUMNS = [
  'u.id',
  'u.username',
  'u.display_name',
  'u.avatar_object_key',
  'u.avatar_url',
  'u.is_bot',
] as const;

export function toUserSummary(config: Config, u: UserColumns): UserSummary {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: userAvatarUrl(config, u),
    is_bot: u.is_bot,
  };
}
