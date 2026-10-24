import { z } from 'zod';

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : undefined;
  });

export const aiEnvSchema = z.object({
  ANTHROPIC_API_KEY: optionalSecret,
  GROQ_API_KEY_1: optionalSecret,
  GROQ_API_KEY_2: optionalSecret,
  GEMINI_API_KEY_1: optionalSecret,
  GEMINI_API_KEY_2: optionalSecret,
  AI_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(25_000),
  AI_TOTAL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
});

export interface AiConfig {
  anthropicApiKey: string | undefined;
  groqApiKeys: [string | undefined, string | undefined];
  geminiApiKeys: [string | undefined, string | undefined];
  attemptTimeoutMs: number;
  totalTimeoutMs: number;
}

/** Reads only the AI env vars. Missing keys are allowed: that entry of the chain is skipped. */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsed = aiEnvSchema.parse({
    ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY'],
    GROQ_API_KEY_1: env['GROQ_API_KEY_1'],
    GROQ_API_KEY_2: env['GROQ_API_KEY_2'],
    GEMINI_API_KEY_1: env['GEMINI_API_KEY_1'],
    GEMINI_API_KEY_2: env['GEMINI_API_KEY_2'],
    AI_ATTEMPT_TIMEOUT_MS: env['AI_ATTEMPT_TIMEOUT_MS'] || undefined,
    AI_TOTAL_TIMEOUT_MS: env['AI_TOTAL_TIMEOUT_MS'] || undefined,
  });
  return {
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    groqApiKeys: [parsed.GROQ_API_KEY_1, parsed.GROQ_API_KEY_2],
    geminiApiKeys: [parsed.GEMINI_API_KEY_1, parsed.GEMINI_API_KEY_2],
    attemptTimeoutMs: parsed.AI_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs: parsed.AI_TOTAL_TIMEOUT_MS,
  };
}
