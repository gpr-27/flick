import { AiChatPrivacy, AiChatPrivacyParams, AiPreference, makeError } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { clearAiData, exportAiData } from './data-registry.js';
import { getSpeed, isAiAllowed, setAiAllowed, setSpeed } from './privacy.js';
import { clearUsage, readUsage } from './quota.js';
import { getMembership } from './context.js';

/** Usage, per-chat privacy, speed preference and "my AI data". Not counted against the daily quota. */
export function aiControlRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, redis, config } = deps;
  const pre = { preHandler: app.authenticate };

  // Built-in data (per-chat switches, speed, usage) is handled here; other modules register theirs.
  async function clearAll(userId: string): Promise<void> {
    await db.deleteFrom('ai_chat_privacy').where('user_id', '=', userId).execute();
    await redis.del(`ai:speed:${userId}`).catch(() => undefined);
    await clearUsage(redis, userId);
    await clearAiData(userId);
  }
  async function exportAll(userId: string): Promise<Record<string, unknown>> {
    const chats = await db
      .selectFrom('ai_chat_privacy')
      .select(['conversation_id', 'allow'])
      .where('user_id', '=', userId)
      .execute();
    return {
      settings: { chat_privacy: chats, speed: await getSpeed(redis, userId) },
      usage_today: await readUsage(redis, userId, config.AI_DAILY_LIMIT),
      ...(await exportAiData(userId)),
    };
  }

  app.get('/ai/usage', pre, (req) => readUsage(redis, req.auth!.userId, config.AI_DAILY_LIMIT));

  app.get('/ai/privacy/:conversation_id', pre, async (req, reply) => {
    const params = AiChatPrivacyParams.safeParse(req.params);
    if (!params.success)
      return reply.code(400).send({ error: makeError('VALIDATION_FAILED', 'Invalid id') });
    return { allow: await isAiAllowed(db, req.auth!.userId, params.data.conversation_id) };
  });

  app.put('/ai/privacy/:conversation_id', pre, async (req, reply) => {
    const params = AiChatPrivacyParams.safeParse(req.params);
    const body = AiChatPrivacy.safeParse(req.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: makeError('VALIDATION_FAILED', 'Invalid request') });
    const userId = req.auth!.userId;
    if (!(await getMembership(db, params.data.conversation_id, userId)))
      return reply.code(404).send({ error: makeError('NOT_FOUND', 'Conversation not found.') });
    await setAiAllowed(db, userId, params.data.conversation_id, body.data.allow);
    return { allow: body.data.allow };
  });

  app.get('/ai/preference', pre, async (req) => ({
    speed: await getSpeed(redis, req.auth!.userId),
  }));

  app.put('/ai/preference', pre, async (req, reply) => {
    const body = AiPreference.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: makeError('VALIDATION_FAILED', 'Invalid request') });
    await setSpeed(redis, req.auth!.userId, body.data.speed);
    return body.data;
  });

  app.get('/ai/data', pre, (req) => exportAll(req.auth!.userId));

  app.delete('/ai/data', pre, async (req, reply) => {
    await clearAll(req.auth!.userId);
    return reply.code(204).send();
  });
}
