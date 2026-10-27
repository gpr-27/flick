import { z } from 'zod';
import { Id } from '../common.js';

/** POST /ai/transcribe: speech-to-text of a voice message the caller can open. */
export const TranscribeRequest = z.object({
  attachment_id: Id,
  /** "It is really Telugu": transcribe again with this language (a name or ISO code). */
  language: z.string().trim().min(2).max(40).optional(),
});
export const TranscribeResponse = z.object({ text: z.string() });
