import { z } from 'zod';
import { Id } from '../common.js';

/** GET /ai/usage: today's AI requests (the day runs midnight to midnight UTC). */
export const AiUsage = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().min(1),
  resets_at: z.string(),
  by_feature: z.array(z.object({ feature: z.string(), count: z.number().int().min(0) })),
});

/** "Allow Flick to read this chat" (default on). */
export const AiChatPrivacy = z.object({ allow: z.boolean() });
export const AiChatPrivacyParams = z.object({ conversation_id: Id });

/** 'fast' tries the quick providers first; 'quality' the best model first. */
export const AiPreference = z.object({ speed: z.enum(['fast', 'quality']) });

/** GET /ai/data: everything modules registered as "my AI data", as one JSON object. */
export const AiDataExport = z.record(z.string(), z.unknown());

export type AiUsageResponse = z.infer<typeof AiUsage>;
