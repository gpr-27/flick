// After a new message has been emitted to the room: decide who is alerted, write their
// notification-centre rows and queue the push jobs. See docs/features/notifications.md.
import { createHash } from 'node:crypto';
import type { MessageRow, NotificationKind, OutboxRow } from '@chat/db';
import { albumOf, isSilentAlbumItem } from '@chat/shared';
import { fromKysely } from 'pg-boss';
import { messagesDelivered } from '../../metrics.js';
import { insertAlerts } from '../notifications/repo.js';
import type { DispatchContext } from './dispatch.js';

export const NOTIFY_QUEUE = 'notify';

/**
 * A person whose socket is "connected" may still have a frozen background tab or a phone app that
 * was just closed (the server only notices after the ping times out). Such a person never sends a
 * delivery receipt, so their job runs after this many seconds and pushes if nothing arrived.
 */
export const CONNECTED_GRACE_SECONDS = 8;

/** Bookkeeping messages written by the server never alert anyone. */
const QUIET_TYPES: ReadonlySet<string> = new Set(['system', 'call_event']);

/**
 * The same outbox row dispatched again (after a crash) must not queue a second notification.
 * A job id is a primary key, so a fixed id per (event, user) makes the second insert a no-op.
 * (singletonKey does not do this on a standard queue.)
 */
function notifyJobId(eventId: string, userId: string): string {
  const h = createHash('sha256').update(`${eventId}:${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Why this person is alerted: named in the message, or the message answers theirs, or neither. */
export function alertKind(
  message: Pick<MessageRow, 'mentions'>,
  userId: string,
  repliedToSender: string | null,
): NotificationKind {
  if (message.mentions.includes(userId)) return 'mention';
  if (repliedToSender === userId) return 'reply';
  return 'message';
}

export interface Recipient {
  user_id: string;
  unmuted: boolean;
}

export async function queueNotifications(
  row: OutboxRow,
  message: MessageRow,
  others: Recipient[],
  ctx: DispatchContext,
): Promise<void> {
  if (others.length === 0 || QUIET_TYPES.has(message.type)) return;
  // An album is N messages but one alert ("4 photos"), sent for its first item. Unread counts
  // still count every item; only the alert (centre row, push) is skipped for the rest.
  if (isSilentAlbumItem(albumOf(message.content))) return;
  const sockets = await ctx.io.in(others.map((m) => `user:${m.user_id}`)).fetchSockets();
  const connected = new Set(sockets.flatMap((s) => [...s.rooms]));
  messagesDelivered.inc(others.filter((m) => connected.has(`user:${m.user_id}`)).length);

  const parent = message.reply_to_id
    ? await ctx.db
        .selectFrom('messages')
        .select('sender_id')
        .where('id', '=', message.reply_to_id)
        .executeTakeFirst()
    : undefined;

  const alerted: { member: Recipient; kind: NotificationKind; online: boolean }[] = [];
  for (const member of others) {
    const kind = alertKind(message, member.user_id, parent?.sender_id ?? null);
    // A muted chat stays silent, except for a mention of the person or a reply to them.
    if (!member.unmuted && kind === 'message') continue;
    alerted.push({ member, kind, online: connected.has(`user:${member.user_id}`) });
  }

  // The centre gets a row now for people who are away, and for mentions and replies to anyone
  // (a person looking at another chat should still see them). Other online people already saw the
  // message live; the job writes a row for them only if it turns out they did not.
  const created = await insertAlerts(
    ctx.db,
    alerted
      .filter((a) => !a.online || a.kind !== 'message')
      .map((a) => ({
        userId: a.member.user_id,
        conversationId: message.conversation_id,
        messageId: message.id,
        kind: a.kind,
      })),
  );
  for (const alert of created) {
    ctx.io.to(`user:${alert.user_id}`).emit('notification_created', {
      id: alert.id,
      kind: alert.kind,
      conversation_id: alert.conversation_id,
      message_id: alert.message_id,
      created_at: alert.created_at.toISOString(),
    });
  }

  for (const { member, kind, online } of alerted) {
    await ctx.boss.send(
      NOTIFY_QUEUE,
      {
        user_id: member.user_id,
        conversation_id: message.conversation_id,
        message_id: message.id,
        seq: message.seq,
        kind,
      },
      {
        db: fromKysely(ctx.db),
        id: notifyJobId(row.event_id, member.user_id),
        ...(online ? { startAfter: CONNECTED_GRACE_SECONDS } : {}),
      },
    );
  }
}
