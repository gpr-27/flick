import { z } from 'zod';
import { Id } from '../common.js';
import { LIMITS } from '../limits.js';

// The server tries providers in a fixed order (Anthropic, then Groq, then Gemini) and skips
// ones that are cooling down. Every endpoint answers JSON, or server-sent events when the
// client asks for text/event-stream (POST /ai/chat uses `stream: true` instead).
//
// Chat text for summaries, reply suggestions and "ask with context" is loaded by the server
// from the conversations the caller is an active member of. The client sends only the id.
//
// @flick: when a message's text mentions @flick (see mentionsFlick in content.ts),
// the server asks the AI and posts the answer in that conversation as the Flick bot
// user (UserSummary.is_bot = true). That reply is a normal message with its own seq.

/** POST /ai/summarize and POST /ai/suggest-replies */
export const AiConversationRequest = z.object({ conversation_id: Id });

/** POST /ai/translate */
export const AiTranslateRequest = z.object({
  text: z.string().trim().min(1).max(5_000),
  /** A language name or code, e.g. "Hindi" or "fr". */
  targetLang: z.string().trim().min(2).max(40),
  /** The chat the text comes from, so the chat's "AI off" switch applies. */
  conversation_id: Id.optional(),
});

/** Tones "rewrite" can aim for. */
export const AI_COMPOSE_TONES = ['casual', 'formal', 'shorter', 'longer', 'friendly'] as const;
export const AiComposeTone = z.enum(AI_COMPOSE_TONES);

/** How long a written message should be, relative to the usual chat length. */
export const AI_COMPOSE_LENGTHS = ['shorter', 'longer'] as const;
export const AiComposeLength = z.enum(AI_COMPOSE_LENGTHS);

/** One-tap changes "refine" can make to a draft. "custom" uses `instruction`. */
export const AI_REFINE_ACTIONS = [
  'formalize',
  'elaborate',
  'shorten',
  'casual',
  'friendly',
  'grammar',
  'emojis',
  'translate',
  'custom',
] as const;
export const AiRefineAction = z.enum(AI_REFINE_ACTIONS);

/**
 * POST /ai/compose ("Write with Flick"). The answer is text for the composer; it is never sent.
 * - polish: fix grammar and clarity, keep the meaning and the language.
 * - rewrite: rephrase `text`, optionally in a `tone`.
 * - write: turn an instruction ("tell Ravi I'll be late") into a ready message. `text` is the
 *   instruction; `draft` may hold what is already in the box. `tone` and `length` steer the style.
 * - refine: change `text` with one `action`; "translate" needs `language`, "custom" an `instruction`.
 * - reply: draft a reply to the chat. The server reads the last ~10 messages itself (the caller
 *   must be a member of `conversation_id`); `text` is an optional hint ("say yes").
 */
export const AiComposeRequest = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('polish'),
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
  }),
  z.object({
    mode: z.literal('rewrite'),
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
    tone: AiComposeTone.optional(),
  }),
  z.object({
    mode: z.literal('write'),
    text: z.string().trim().min(1).max(2_000),
    draft: z.string().max(LIMITS.MAX_TEXT_LENGTH).optional(),
    /** Lets the server apply this chat's style. */
    conversation_id: Id.optional(),
    tone: AiComposeTone.optional(),
    length: AiComposeLength.optional(),
  }),
  z.object({
    mode: z.literal('refine'),
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
    action: AiRefineAction,
    language: z.string().trim().min(2).max(40).optional(),
    instruction: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    mode: z.literal('reply'),
    conversation_id: Id,
    text: z.string().trim().min(1).max(500).optional(),
    draft: z.string().max(LIMITS.MAX_TEXT_LENGTH).optional(),
    tone: AiComposeTone.optional(),
    length: AiComposeLength.optional(),
  }),
  // cleanup: dictated speech to tidy text (no fillers or repeats); simplify: plain, short words;
  // bullets: turn notes into a message; bio: a short profile "About" from the hints in `text`;
  // code: explain a code snippet; complete: the next few words after `text` (ghost text).
  z.object({
    mode: z.enum(['cleanup', 'simplify', 'bullets', 'bio', 'code']),
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
  }),
  z.object({
    mode: z.literal('complete'),
    text: z.string().trim().min(1).max(600),
    conversation_id: Id.optional(),
  }),
  // tone: check how `text` may read to the other person; the answer is "OK" or a note plus a softer version.
  z.object({
    mode: z.literal('tone'),
    text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
  }),
]);
export type AiComposeRequest = z.infer<typeof AiComposeRequest>;

/** POST /ai/chat ("Ask Flick") */
export const AskAiRequest = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8_000) }))
    .min(1)
    .max(30),
  /** Optional: let the AI read the last messages of this conversation (the user must be a member). */
  conversation_id: Id.optional(),
  /** true = stream the answer as server-sent events. */
  stream: z.boolean().default(false),
});

/** JSON answer of summarize, translate and chat. */
export const AskAiResponse = z.object({
  text: z.string(),
  provider: z.string(),
  model: z.string(),
});

/** JSON answer of suggest-replies: exactly three short replies. */
export const SuggestRepliesResponse = z.object({
  replies: z.array(z.string()).length(3),
  provider: z.string(),
  model: z.string(),
});

/**
 * The server-sent events, in order: `meta`, then `delta` (repeated) or one `result`,
 * then `done`. A failure after the first byte arrives as `error`.
 */
export const AiStreamEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('meta'),
    data: z.object({ provider: z.string(), model: z.string() }),
  }),
  z.object({ event: z.literal('delta'), data: z.object({ text: z.string() }) }),
  z.object({
    event: z.literal('result'),
    data: z.object({ replies: z.array(z.string()).length(3) }),
  }),
  z.object({
    event: z.literal('done'),
    data: z.object({ provider: z.string(), model: z.string() }),
  }),
  z.object({
    event: z.literal('error'),
    data: z.object({ error: z.string(), message: z.string() }),
  }),
]);

export const AiStatus = z.object({
  /** false when no provider key is configured. */
  enabled: z.boolean(),
});
