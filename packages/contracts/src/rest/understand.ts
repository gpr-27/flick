import { z } from 'zod';
import { Id } from '../common.js';

/**
 * POST /ai/understand: helps a person understand a conversation. The server reads the chat itself
 * (the caller must be a member); the client sends only ids and the question.
 * - catchup: what happened in the unread messages (decisions, questions, deadlines).
 * - topics: the chat grouped into topics with a jump anchor.
 * - recap: answer `question` from the messages between `from` and `to`.
 * - check: check the claim or link in one message (says what it cannot verify), or its mood.
 * - search: answer a question from the person's top matching messages, with sources.
 */
export const UnderstandRequest = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('catchup'), conversation_id: Id }),
  z.object({ mode: z.literal('topics'), conversation_id: Id }),
  z.object({
    mode: z.literal('recap'),
    conversation_id: Id,
    question: z.string().trim().min(2).max(300),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  }),
  z.object({
    mode: z.literal('check'),
    conversation_id: Id,
    message_id: Id,
    /** facts (default): check the claim or link. mood: how the message comes across. */
    aspect: z.enum(['facts', 'mood']).optional(),
  }),
  z.object({ mode: z.literal('search'), query: z.string().trim().min(3).max(300) }),
]);

export const UNDERSTAND_KINDS = ['decision', 'question', 'deadline', 'topic', 'source'] as const;

/** A point the model found, with the message it came from when known (tap to jump). */
export const UnderstandItem = z.object({
  kind: z.enum(UNDERSTAND_KINDS),
  text: z.string(),
  conversation_id: Id.optional(),
  message_id: Id.optional(),
  seq: z.number().int().optional(),
});

export const UnderstandResponse = z.object({
  /** Short answer or overview. */
  text: z.string(),
  items: z.array(UnderstandItem),
  provider: z.string(),
  model: z.string(),
});
