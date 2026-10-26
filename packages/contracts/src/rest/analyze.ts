import { z } from 'zod';
import { Id } from '../common.js';

/** What Flick should do with the file(s). Without a mode (or `explain`) it answers the question. */
export const AnalyzeMode = z.enum([
  'explain',
  'table',
  'translate',
  'highlight',
  'compare',
  'receipt',
]);

/**
 * POST /ai/analyze: Flick explains an image, PDF, text file or voice note the caller can open.
 * Send `attachment_id` for one file or `attachment_ids` (up to 4) to ask across several.
 */
export const AnalyzeRequest = z
  .object({
    attachment_id: Id.optional(),
    attachment_ids: z.array(Id).min(1).max(4).optional(),
    /** A follow-up question. Without it Flick gives the default explanation for the file type. */
    question: z.string().trim().min(1).max(1_000).optional(),
    mode: AnalyzeMode.optional(),
    /** Target language for `translate`. */
    language: z.string().trim().min(1).max(60).optional(),
  })
  .refine((v) => v.attachment_id !== undefined || v.attachment_ids !== undefined, {
    message: 'attachment_id is required',
    path: ['attachment_id'],
  });
export const AnalyzeResponse = z.object({ text: z.string() });
