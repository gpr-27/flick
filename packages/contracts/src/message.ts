import { z } from 'zod';
import { ClientMessageId, Emoji, Id, IsoDateTime, Seq } from './common.js';
import { MessageContent, SERVER_ONLY_CONTENT } from './content.js';

/** Payload of WS `send_message`, and body of the REST fallback. */
export const SendMessageInput = z.object({
  conversation_id: Id,
  /** Idempotency key: the server keeps one message per (sender device, client_message_id). */
  client_message_id: ClientMessageId,
  content: MessageContent.refine(
    (c) => !SERVER_ONLY_CONTENT.includes(c.type),
    'clients cannot send this content type',
  ),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

/** Sent only after the transaction (seq + message + outbox row) has committed. */
export const MessageAccepted = z.object({
  client_message_id: ClientMessageId,
  message_id: Id,
  conversation_id: Id,
  seq: Seq,
  created_at: IsoDateTime,
  /** True when this was a retry: the original message_id and seq are returned. */
  duplicate: z.boolean(),
});
export type MessageAccepted = z.infer<typeof MessageAccepted>;

/** A message as the server returns it (live, history and sync). */
export const MessageRecord = z.object({
  message_id: Id,
  conversation_id: Id,
  seq: Seq,
  /** null for server-written system messages. */
  sender_user_id: Id.nullable(),
  client_message_id: ClientMessageId.nullable(),
  /** null when deleted for everyone, or a view-once message the caller already opened. */
  content: MessageContent.nullable(),
  created_at: IsoDateTime,
  edited_at: IsoDateTime.nullable(),
  deleted_at: IsoDateTime.nullable(),
  /** Set when the conversation has a disappearing timer. */
  expires_at: IsoDateTime.nullable(),
  reactions: z.array(z.object({ emoji: Emoji, user_ids: z.array(Id) })),
  starred: z.boolean(),
  /** For the sender of a view-once message: whether anyone opened it. Always false for others. */
  viewed: z.boolean(),
});
export type MessageRecord = z.infer<typeof MessageRecord>;
