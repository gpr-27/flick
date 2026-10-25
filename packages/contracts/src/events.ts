import { z } from 'zod';
import { Emoji, Id, IsoDateTime, MemberRole, Seq } from './common.js';
import { LIMITS } from './limits.js';

/**
 * Redpanda (Kafka) records. They are written only from the outbox table, in the
 * same transaction as the change. The record key is always the conversation id,
 * so one conversation stays on one partition and its events stay in order.
 * Consumers skip event_ids they already processed, so publishing twice is safe.
 */
export const TOPICS = {
  MESSAGE: 'chat.message.v1',
  RECEIPT: 'chat.receipt.v1',
  CONVERSATION: 'chat.conversation.v1',
  FANOUT: 'chat.fanout.v1',
  DLQ: 'chat.dlq.v1',
} as const;

function event<T extends string, D extends z.ZodRawShape>(type: T, data: D) {
  return z
    .object({
      event_id: Id,
      schema_version: z.literal(1),
      occurred_at: IsoDateTime,
      /** Kafka record key. Must equal conversation_id. */
      key: Id,
      type: z.literal(type),
      conversation_id: Id,
      data: z.object(data),
    })
    .refine((e) => e.key === e.conversation_id, {
      message: 'key must equal conversation_id',
      path: ['key'],
    });
}

// chat.message.v1: every change that takes a conversation seq.
export const MessageEvent = z.discriminatedUnion('type', [
  event('message.created', {
    message_id: Id,
    seq: Seq,
    sender_user_id: Id.nullable(),
    sender_device_id: Id.nullable(),
    mentions_flick: z.boolean(),
  }),
  event('message.edited', { message_id: Id, seq: Seq }),
  event('message.deleted', { message_id: Id, seq: Seq }),
  event('reaction.added', { message_id: Id, seq: Seq, user_id: Id, emoji: Emoji }),
  event('reaction.removed', { message_id: Id, seq: Seq, user_id: Id, emoji: Emoji }),
]);

// chat.receipt.v1
export const ReceiptEvent = z.discriminatedUnion('type', [
  event('receipt.delivered', { user_id: Id, device_id: Id, delivered_seq: Seq }),
  event('receipt.read', { user_id: Id, read_seq: Seq }),
]);

// chat.conversation.v1
export const ConversationEvent = z.discriminatedUnion('type', [
  event('conversation.created', { created_by: Id, member_ids: z.array(Id) }),
  event('conversation.updated', { actor_user_id: Id }),
  event('conversation.members_added', {
    actor_user_id: Id.nullable(),
    user_ids: z.array(Id).min(1),
  }),
  event('conversation.member_removed', { actor_user_id: Id.nullable(), user_id: Id }),
  event('conversation.role_changed', { actor_user_id: Id, user_id: Id, role: MemberRole }),
  event('conversation.pins_changed', { actor_user_id: Id, message_id: Id, pinned: z.boolean() }),
]);

// chat.fanout.v1: big groups are split into batches of recipients, processed in parallel.
export const FanoutEvent = z.discriminatedUnion('type', [
  event('fanout.batch', {
    message_id: Id,
    seq: Seq,
    batch_index: z.number().int().min(0),
    recipient_user_ids: z.array(Id).min(1).max(LIMITS.FANOUT_BATCH_SIZE),
  }),
]);

// chat.dlq.v1: a record a consumer gave up on, kept for inspection and replay.
export const DeadLetterEvent = event('dlq.record', {
  topic: z.string(),
  partition: z.number().int().min(0),
  offset: z.string(), // Kafka offsets are int64; a string avoids precision loss
  value: z.string(),
  error: z.string(),
  attempts: z.number().int().min(1),
});

export const TOPIC_SCHEMAS = {
  [TOPICS.MESSAGE]: MessageEvent,
  [TOPICS.RECEIPT]: ReceiptEvent,
  [TOPICS.CONVERSATION]: ConversationEvent,
  [TOPICS.FANOUT]: FanoutEvent,
  [TOPICS.DLQ]: DeadLetterEvent,
};

export type BrokerEvent =
  | z.infer<typeof MessageEvent>
  | z.infer<typeof ReceiptEvent>
  | z.infer<typeof ConversationEvent>
  | z.infer<typeof FanoutEvent>
  | z.infer<typeof DeadLetterEvent>;
