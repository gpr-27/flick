import { z } from 'zod';
import { Id } from '../common.js';

/** POST /ai/transcribe: speech-to-text of a voice message the caller can open. */
export const TranscribeRequest = z.object({ attachment_id: Id });
export const TranscribeResponse = z.object({ text: z.string() });
