import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

// Writing, replying and acting: the user's writing style, a style per chat, "do it for me" actions,
// the plan assistant, poll drafts, flashcards and the Flick persona.

/** GET /ai/style-profile: a short summary of how the user writes, or null until it is made. */
export const AiStyleProfile = z.object({
  summary: z.string().nullable(),
  updated_at: IsoDateTime.nullable(),
});

export const AI_CHAT_STYLES = ['none', 'formal', 'casual', 'friendly', 'custom'] as const;
export const AiChatStyle = z.object({
  style: z.enum(AI_CHAT_STYLES),
  /** Only with style 'custom': e.g. "short and teasing". */
  custom: z.string().trim().max(200).nullable().optional(),
});
export const AiChatStyleParams = z.object({ conversation_id: Id });

export const AI_PERSONAS = ['default', 'concise', 'friendly', 'formal', 'tutor'] as const;
export const AiPersona = z.object({
  persona: z.enum(AI_PERSONAS),
  /** Language tutor only. */
  language: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\p{L} -]*$/u)
    .nullable()
    .optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).nullable().optional(),
});

/** What the clock says for the person: the server needs it to read "tomorrow 9am". */
const Clock = z.object({
  now: IsoDateTime,
  /** Minutes east of UTC (the negative of Date.getTimezoneOffset()). */
  tz_offset_min: z.number().int().min(-840).max(840),
});

/** POST /ai/actions: "remind me Friday 6pm to call mom and message Ravi tomorrow 9am ..." */
export const AiActionsRequest = Clock.extend({
  text: z.string().trim().min(1).max(1_000),
});
export const AiAction = z.object({
  kind: z.enum(['reminder', 'message']),
  /** Reminder note, or the message text to send. */
  text: z.string(),
  /** Message only: who it goes to, as the person said it. null = this chat. */
  to: z.string().nullable(),
  /** When, resolved by the server. null when the time could not be understood. */
  when: IsoDateTime.nullable(),
  /** What the person said about the time, for the card. */
  when_text: z.string(),
});
export const AiActionsResponse = z.object({ actions: z.array(AiAction).max(8) });
export type AiAction = z.infer<typeof AiAction>;

/** POST /ai/plan: "plan dinner with Ravi on Friday" */
export const AiPlanRequest = Clock.extend({
  text: z.string().trim().min(1).max(500),
  conversation_id: Id.optional(),
});
export const AiPlanResponse = z.object({
  title: z.string(),
  slots: z.array(IsoDateTime).max(5),
  invitation: z.string(),
  /** How many of the person's own reminders / scheduled messages were counted as busy. */
  busy_count: z.number().int().min(0),
});

/** POST /ai/poll-draft: a plain question in, a poll out. */
export const AiPollDraftRequest = z.object({ text: z.string().trim().min(1).max(500) });
export const AiPollDraftResponse = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(10),
});

/** POST /ai/flashcards: from the last messages of a chat, or from pasted text. */
export const AiFlashcardsRequest = z
  .object({
    conversation_id: Id.optional(),
    text: z.string().trim().min(1).max(12_000).optional(),
  })
  .refine((v) => v.conversation_id !== undefined || v.text !== undefined, {
    message: 'Give a conversation_id or text',
    path: ['text'],
  });
export const AiFlashcardsResponse = z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string() })).max(20),
  quiz: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        answer: z.number().int().min(0).max(3),
      }),
    )
    .max(10),
});

/** POST /ai/dictate: a short recording in, cleaned-up text out (base64 audio). */
export const AiDictateRequest = z.object({
  audio: z.string().min(1).max(8_000_000),
  mime: z.string().min(1).max(60),
});
export const AiDictateResponse = z.object({ text: z.string() });
