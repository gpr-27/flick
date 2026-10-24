import { AiChain, AiTasks, RedisCooldownStore, loadAiConfig } from '@chat/ai';
import type { Config } from '../../config.js';
import type { Logger } from '../../logger.js';
import { aiAttemptDuration, aiAttempts } from '../../metrics.js';
import type { Redis } from '../../redis.js';

/** The AI chain plus its task helpers. One per process; shared by the routes and the @flick bot. */
export interface AiService {
  chain: AiChain;
  tasks: AiTasks;
  /** false when no provider key is set. The routes then answer 503 and the bot stays quiet. */
  enabled: boolean;
}

export const AI_KEY_NAMES =
  'ANTHROPIC_API_KEY, GROQ_API_KEY_1, GROQ_API_KEY_2, GEMINI_API_KEY_1 or GEMINI_API_KEY_2';

export function aiServiceFromChain(chain: AiChain): AiService {
  return { chain, tasks: new AiTasks(chain), enabled: chain.configured };
}

export function createAiService(deps: { config: Config; redis: Redis; logger: Logger }): AiService {
  const { config, redis, logger } = deps;
  const aiConfig = loadAiConfig({
    ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
    GROQ_API_KEY_1: config.GROQ_API_KEY_1,
    GROQ_API_KEY_2: config.GROQ_API_KEY_2,
    GEMINI_API_KEY_1: config.GEMINI_API_KEY_1,
    GEMINI_API_KEY_2: config.GEMINI_API_KEY_2,
  });
  const chain = AiChain.fromConfig(aiConfig, {
    // Cooldowns live in Redis so every API replica skips a rate-limited provider.
    cooldowns: new RedisCooldownStore(redis, logger),
    logger,
    // Only provider and result become labels; account and model would add series for no benefit.
    metrics: {
      attempt: (l) => aiAttempts.inc({ provider: l.provider, result: l.result }),
      latency: (l, ms) =>
        aiAttemptDuration.observe({ provider: l.provider, result: l.result }, ms / 1000),
    },
  });
  return aiServiceFromChain(chain);
}
