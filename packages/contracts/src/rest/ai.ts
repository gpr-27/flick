import { z } from 'zod';
import { Id } from '../common.js';

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
});

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
