import { z } from 'zod';
import { Id } from '../common.js';

/** A stored transcript of a voice note or audio file, shared with everyone in the chat. */
export const Transcript = z.object({
  text: z.string(),
  language: z.string().nullable(),
  summary: z.string().nullable(),
});
export const TranscriptParams = z.object({ attachment_id: Id });
/** GET /ai/transcript/:attachment_id: the stored transcript, or null when there is none yet. */
export const TranscriptLookup = z.object({ transcript: Transcript.nullable() });
export const EditTranscriptRequest = z.object({ text: z.string().trim().min(1).max(20_000) });

const Language = z.string().trim().min(2).max(40);

/** GET/PUT /ai/auto-translate/:conversation_id: translate this chat for me (null = off). */
export const TranslationConversationParams = z.object({ conversation_id: Id });
export const AutoTranslatePref = z.object({ target_language: Language.nullable() });

/** GET/PUT /ai/transcribe-prefs/:conversation_id: transcribe voice notes in this chat on arrival. */
export const ChatTranscribePref = z.object({ enabled: z.boolean() });

/** GET/PATCH /ai/translation-settings: my global auto-transcribe switch and "don't translate" words. */
export const TranslationSettings = z.object({
  auto_transcribe: z.boolean(),
  dont_translate: z.array(z.string().trim().min(1).max(60)).max(100),
});
export const UpdateTranslationSettings = TranslationSettings.partial();

/** POST /ai/translate-batch: translate several texts at once (visible messages, or one draft). */
export const TranslateBatchRequest = z.object({
  /** The chat the texts belong to: its "Allow Flick to read this chat" switch applies. */
  conversation_id: Id,
  target_language: Language,
  items: z
    .array(z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(4_000) }))
    .min(1)
    .max(20),
  /** Message ids are cached per reader and language; a draft has none. */
  cache: z.boolean().optional(),
});
export const TranslateBatchResponse = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string().nullable() })),
});

export type TranscriptData = z.infer<typeof Transcript>;
