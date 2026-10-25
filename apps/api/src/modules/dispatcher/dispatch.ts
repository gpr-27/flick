// Turns one outbox row into Socket.IO emits. Recipients are read from Postgres NOW (never from a
// cache), so a member who was just removed does not get the next message. Emitting twice is safe:
// clients ignore a seq they already have.
import { LIMITS, TOPICS } from '@chat/contracts';
import { MESSAGE_COLUMNS, MESSAGE_TOPIC, type MessageRow, type OutboxRow } from '@chat/db';
import { sql } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Server } from 'socket.io';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { messageDispatchLatency } from '../../metrics.js';
import { fromRow } from '../messages/domain/content.js';
import { getConversation } from '../conversations/repo/summaries.js';
import { queueNotifications } from './notify.js';

export { NOTIFY_QUEUE } from './notify.js';

export interface DispatchContext {
  /** The transaction that claimed the row: reads see current membership, and the notify job is
   * written through it, so "row done" and "notification queued" commit together. */
  db: Db;
  io: Server;
  config: Config;
  boss: Pick<PgBoss, 'send'>;
  /** Called, without waiting, once a new message has been delivered (the @flick bot uses it). */
  onMessageCreated?: (message: MessageRow) => void;
}

interface Payload {
  type: string;
  conversation_id: string;
  message_id?: string;
  seq?: number;
  user_id?: string;
  emoji?: string;
  device_id?: string;
  delivered_seq?: number;
  read_seq?: number;
  sender_id?: string | null;
  sender_device_id?: string | null;
  data?: { user_id?: string; actor_user_id?: string; message_id?: string; pinned?: boolean };
}

export async function dispatchRow(row: OutboxRow, ctx: DispatchContext): Promise<void> {
  const p = row.payload as unknown as Payload;
  if (row.topic === MESSAGE_TOPIC) {
    return p.type === 'message.created' ? newMessage(row, p, ctx) : messageChange(p, ctx);
  }
  if (row.topic === TOPICS.RECEIPT) return receipt(p, ctx);
  if (row.topic === TOPICS.CONVERSATION) return conversationChanged(p, ctx);
  // Any other topic has nothing to deliver live.
}

/** The people in the conversation right now. Bots have no devices and get no notifications. */
async function activeMembers(db: Db, conversationId: string) {
  return db
    .selectFrom('conversation_members as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select([
      'm.user_id',
      sql<boolean>`(m.muted_until IS NULL OR m.muted_until <= now())`.as('unmuted'),
    ])
    .where('m.conversation_id', '=', conversationId)
    .where('m.left_at', 'is', null)
    .where('u.status', '=', 'active')
    .where('u.is_bot', '=', false)
    .execute();
}

/** Big groups go out in batches, yielding in between, so one fan-out cannot hog the event loop. */
async function inBatches<T>(items: T[], each: (batch: T[]) => Promise<void> | void): Promise<void> {
  const size =
    items.length > LIMITS.INLINE_FANOUT_MAX_MEMBERS ? LIMITS.FANOUT_BATCH_SIZE : items.length;
  for (let i = 0; i < items.length; i += size) {
    await each(items.slice(i, i + size));
    if (i + size < items.length) await new Promise((resolve) => setImmediate(resolve));
  }
}

async function emitToUsers(
  ctx: DispatchContext,
  userIds: string[],
  event: string,
  payload: object,
) {
  await inBatches(userIds, (batch) => {
    ctx.io.to(batch.map((id) => `user:${id}`)).emit(event as never, payload);
  });
}

async function loadMessage(db: Db, id: string) {
  return db.selectFrom('messages').select(MESSAGE_COLUMNS).where('id', '=', id).executeTakeFirst();
}

async function newMessage(row: OutboxRow, p: Payload, ctx: DispatchContext): Promise<void> {
  const message = await loadMessage(ctx.db, p.message_id!);
  if (!message) return;
  const record = {
    message_id: message.id,
    conversation_id: message.conversation_id,
    seq: message.seq,
    sender_user_id: message.sender_id,
    client_message_id: null,
    content: message.deleted_at ? null : fromRow(message),
    created_at: message.created_at.toISOString(),
    edited_at: message.edited_at?.toISOString() ?? null,
    deleted_at: message.deleted_at?.toISOString() ?? null,
    expires_at: message.expire_at?.toISOString() ?? null,
    reactions: [],
    starred: false,
    viewed: false,
  };
  const members = await activeMembers(ctx.db, message.conversation_id);
  const others = members.filter((m) => m.user_id !== message.sender_id);

  await emitToUsers(
    ctx,
    others.map((m) => m.user_id),
    'new_message',
    { message: record },
  );
  // The sender's other devices get it too, with their own client_message_id; the sending device
  // already has the message from its send_message ack.
  if (message.sender_id && members.some((m) => m.user_id === message.sender_id)) {
    const sender = ctx.io.to(`user:${message.sender_id}`);
    (message.sender_device_id ? sender.except(`device:${message.sender_device_id}`) : sender).emit(
      'new_message',
      { message: { ...record, client_message_id: message.client_message_id } },
    );
  }

  ctx.onMessageCreated?.(message);
  messageDispatchLatency.observe((Date.now() - message.created_at.getTime()) / 1000);

  await queueNotifications(row, message, others, ctx);
}

/** Edits, deletes and reactions: sent to everyone in the conversation, including the actor. */
async function messageChange(p: Payload, ctx: DispatchContext): Promise<void> {
  const common = { conversation_id: p.conversation_id, seq: p.seq!, message_id: p.message_id! };
  const members = (await activeMembers(ctx.db, p.conversation_id)).map((m) => m.user_id);

  if (p.type === 'message.edited' || p.type === 'message.deleted') {
    const message = await loadMessage(ctx.db, p.message_id!);
    if (!message) return;
    return p.type === 'message.edited'
      ? emitToUsers(ctx, members, 'message_edited', {
          ...common,
          content: fromRow(message),
          edited_at: (message.edited_at ?? new Date()).toISOString(),
        })
      : emitToUsers(ctx, members, 'message_deleted', {
          ...common,
          deleted_by: p.user_id ?? message.sender_id,
          deleted_at: (message.deleted_at ?? new Date()).toISOString(),
        });
  }
  const event = p.type === 'reaction.added' ? 'reaction_added' : 'reaction_removed';
  await emitToUsers(ctx, members, event, { ...common, user_id: p.user_id, emoji: p.emoji });
}

async function receipt(p: Payload, ctx: DispatchContext): Promise<void> {
  let recipients = (await activeMembers(ctx.db, p.conversation_id)).map((m) => m.user_id);
  if (p.type === 'receipt.read') {
    // Read receipts work both ways: a reader who turned them off shows nothing to others (their
    // own devices still hear), and members who turned them off do not see anyone's.
    const off = await ctx.db
      .selectFrom('user_settings')
      .select('user_id')
      .where('read_receipts', '=', false)
      .where('user_id', 'in', recipients)
      .execute();
    const hidden = new Set(off.map((r) => r.user_id));
    recipients = recipients.filter(
      (id) => id === p.user_id || (!hidden.has(p.user_id!) && !hidden.has(id)),
    );
  }
  await emitToUsers(ctx, recipients, 'receipt_update', {
    conversation_id: p.conversation_id,
    user_id: p.user_id,
    ...(p.type === 'receipt.delivered'
      ? { delivered_seq: p.delivered_seq }
      : { read_seq: p.read_seq }),
  });
}

/** Each member gets their own view of the conversation; a removed user gets `null`. */
async function conversationChanged(p: Payload, ctx: DispatchContext): Promise<void> {
  if (p.type === 'conversation.pins_changed') {
    // Current members only: someone removed since hears nothing about the group.
    const members = (await activeMembers(ctx.db, p.conversation_id)).map((m) => m.user_id);
    return emitToUsers(ctx, members, 'pins_changed', {
      conversation_id: p.conversation_id,
      message_id: p.data?.message_id,
      pinned: p.data?.pinned,
      actor_user_id: p.data?.actor_user_id,
    });
  }
  const users = new Set((await activeMembers(ctx.db, p.conversation_id)).map((m) => m.user_id));
  if (p.type === 'conversation.member_removed' && p.data?.user_id) users.add(p.data.user_id);
  await inBatches([...users], async (batch) => {
    for (const userId of batch) {
      const conversation = await getConversation(
        ctx.db,
        ctx.config,
        userId,
        p.conversation_id,
      ).catch(() => null); // not a member (any more)
      ctx.io
        .to(`user:${userId}`)
        .emit('conversation_updated', { conversation_id: p.conversation_id, conversation });
    }
  });
}
