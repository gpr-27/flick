import { z } from 'zod';
import { Cursor, HttpUrl, Id, IsoDateTime, Seq } from '../common.js';

/** Why the person was alerted. */
export const NotificationKind = z.enum(['message', 'mention', 'reply', 'reminder', 'missed_call']);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * One alert in the notification centre. The server stores no text: `preview` is read from the
 * message when the list is asked for, so a deleted or expired message shows `available: false`.
 */
export const NotificationItem = z.object({
  id: Id,
  kind: NotificationKind,
  created_at: IsoDateTime,
  /** Read by tapping, "mark all read", or by reading the chat itself. */
  read: z.boolean(),
  conversation_id: Id.nullable(),
  message_id: Id.nullable(),
  seq: Seq.nullable(),
  /** False when the message is deleted, expired or hidden for the caller. */
  available: z.boolean(),
  sender_name: z.string().nullable(),
  sender_avatar_url: HttpUrl.nullable(),
  /** The group's name, or the other person's name in a 1:1 chat. */
  chat_name: z.string().nullable(),
  is_group: z.boolean(),
  preview: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationListQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const NotificationList = z.object({
  items: z.array(NotificationItem),
  next_cursor: Cursor.nullable(),
  /** All unread alerts (not only this page), for the bell. */
  unread_count: z.number().int().min(0),
});
export type NotificationList = z.infer<typeof NotificationList>;

export const NotificationUnread = z.object({ unread_count: z.number().int().min(0) });

/** Mark some alerts read, or all of them (`all: true`). */
export const MarkReadRequest = z.union([
  z.object({ ids: z.array(Id).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

/** The live event: a new alert for this person (the bell goes up by one). */
export const NotificationCreatedPayload = z.object({
  id: Id,
  kind: NotificationKind,
  conversation_id: Id.nullable(),
  message_id: Id.nullable(),
  created_at: IsoDateTime,
});
