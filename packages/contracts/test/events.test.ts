import { describe, expect, it } from 'vitest';
import { LIMITS, TOPICS, TOPIC_SCHEMAS } from '../src/index.js';
import { ALICE, BOB, CONV, DEVICE, MSG, NOW, id } from './fixtures.js';

const meta = (n: number) => ({
  event_id: id(1000 + n),
  schema_version: 1,
  occurred_at: NOW,
  key: CONV,
  conversation_id: CONV,
});

const SAMPLES: [string, unknown][] = [
  [
    TOPICS.MESSAGE,
    {
      ...meta(1),
      type: 'message.created',
      data: {
        message_id: MSG,
        seq: 42,
        sender_user_id: ALICE,
        sender_device_id: DEVICE,
        mentions_flick: false,
      },
    },
  ],
  [
    TOPICS.MESSAGE,
    {
      ...meta(2),
      type: 'reaction.added',
      data: { message_id: MSG, seq: 43, user_id: BOB, emoji: '👍' },
    },
  ],
  [
    TOPICS.RECEIPT,
    {
      ...meta(3),
      type: 'receipt.delivered',
      data: { user_id: BOB, device_id: DEVICE, delivered_seq: 42 },
    },
  ],
  [
    TOPICS.CONVERSATION,
    {
      ...meta(4),
      type: 'conversation.members_added',
      data: { actor_user_id: ALICE, user_ids: [BOB] },
    },
  ],
  [
    TOPICS.FANOUT,
    {
      ...meta(5),
      type: 'fanout.batch',
      data: { message_id: MSG, seq: 42, batch_index: 0, recipient_user_ids: [BOB] },
    },
  ],
  [
    TOPICS.DLQ,
    {
      ...meta(6),
      type: 'dlq.record',
      data: {
        topic: TOPICS.MESSAGE,
        partition: 0,
        offset: '123',
        value: '{}',
        error: 'bad',
        attempts: 5,
      },
    },
  ],
];

describe('broker events', () => {
  it('uses the plan topic names', () => {
    expect(Object.values(TOPICS).sort()).toEqual([
      'chat.conversation.v1',
      'chat.dlq.v1',
      'chat.fanout.v1',
      'chat.message.v1',
      'chat.receipt.v1',
    ]);
  });

  it('accepts a valid record on each topic and rejects it on the wrong topic', () => {
    for (const [topic, sample] of SAMPLES) {
      expect(
        TOPIC_SCHEMAS[topic as keyof typeof TOPIC_SCHEMAS].safeParse(sample).success,
        topic,
      ).toBe(true);
    }
    expect(TOPIC_SCHEMAS[TOPICS.RECEIPT].safeParse(SAMPLES[0]?.[1]).success).toBe(false);
  });

  it('requires key = conversation_id, so a conversation stays on one partition', () => {
    const [, sample] = SAMPLES[0] ?? [];
    expect(
      TOPIC_SCHEMAS[TOPICS.MESSAGE].safeParse({ ...(sample as object), key: id(999) }).success,
    ).toBe(false);
  });

  it('caps fan-out batches', () => {
    const tooMany = Array.from({ length: LIMITS.FANOUT_BATCH_SIZE + 1 }, (_, i) => id(5000 + i));
    const batch = {
      ...meta(7),
      type: 'fanout.batch',
      data: { message_id: MSG, seq: 1, batch_index: 0, recipient_user_ids: tooMany },
    };
    expect(TOPIC_SCHEMAS[TOPICS.FANOUT].safeParse(batch).success).toBe(false);
  });
});
