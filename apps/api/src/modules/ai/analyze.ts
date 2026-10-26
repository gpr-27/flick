import { AiAbortedError, AiTimeoutError, AiUnavailableError, RedisRateLimitStore } from '@chat/ai';
import { AnalyzeRequest, makeError } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { rateLimitRejections } from '../../metrics.js';
import { createStorage } from '../media/domain/storage.js';
import {
  AttachmentError,
  analyzeRequest,
  groqTranscriber,
  loadAttachment,
  s3Reader,
  type AttachmentDeps,
} from './attachments.js';
import { modeInstruction } from './analyzeModes.js';
import { AI_KEY_NAMES, createAiService } from './service.js';
import { AI_OFF_MESSAGE, getSpeed } from './privacy.js';
import { quotaMessage, takeQuota } from './quota.js';

const USER_LIMIT = { max: 20, windowMs: 60_000 };

/** Attachment reading on top of storage and (when a Groq key is set) Whisper. Undefined without storage. */
const depsCache = new WeakMap<Db, AttachmentDeps | undefined>();
export function attachmentDeps(config: Config, db: Db): AttachmentDeps | undefined {
  if (depsCache.has(db)) return depsCache.get(db);
  const made = buildAttachmentDeps(config, db);
  depsCache.set(db, made);
  return made;
}

function buildAttachmentDeps(config: Config, db: Db): AttachmentDeps | undefined {
  const storage = createStorage(config);
  if (!storage) return undefined;
  const groqKey = config.GROQ_API_KEY_1 ?? config.GROQ_API_KEY_2;
  return {
    db,
    readObject: s3Reader(storage),
    transcribe: groqKey ? groqTranscriber(groqKey) : undefined,
  };
}

/** POST /ai/analyze: Flick explains a file the caller can open. */
export function analyzeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, redis, logger } = deps;
  const ai = deps.ai ?? createAiService({ config: deps.config, redis, logger });
  const limiter = new RedisRateLimitStore(redis, logger);
  const files = attachmentDeps(deps.config, db);

  app.post('/ai/analyze', { preHandler: app.authenticate }, async (req, reply) => {
    const fail = (status: number, code: Parameters<typeof makeError>[0], message: string) =>
      reply.code(status).send({ error: makeError(code, message) });

    const body = AnalyzeRequest.safeParse(req.body);
    if (!body.success) {
      return fail(400, 'VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid request');
    }
    if (!ai.enabled)
      return fail(503, 'AI_UNAVAILABLE', `AI is not configured. Set ${AI_KEY_NAMES}.`);
    if (!files) return fail(503, 'AI_UNAVAILABLE', 'File storage is not configured.');

    const userId = req.auth!.userId;
    if (!(await takeQuota(redis, userId, 'analyze', deps.config.AI_DAILY_LIMIT))) {
      rateLimitRejections.inc({ scope: 'ai_daily' });
      return fail(429, 'RATE_LIMITED', quotaMessage(deps.config.AI_DAILY_LIMIT));
    }
    const ids = body.data.attachment_ids ?? [body.data.attachment_id!];
    // A file that was sent in a chat where the caller turned AI off is not read either.
    const off = await db
      .selectFrom('messages')
      .innerJoin('ai_chat_privacy as p', 'p.conversation_id', 'messages.conversation_id')
      .select('p.conversation_id')
      .where('messages.attachment_id', 'in', ids)
      .where('p.user_id', '=', userId)
      .where('p.allow', '=', false)
      .executeTakeFirst();
    if (off) return fail(403, 'FORBIDDEN', AI_OFF_MESSAGE);
    const hit = await limiter.hit(`ai:user:${userId}`, USER_LIMIT.windowMs);
    if (hit.count > USER_LIMIT.max) {
      rateLimitRejections.inc({ scope: 'ai_user' });
      reply.header('retry-after', Math.max(1, Math.ceil(hit.resetMs / 1000)));
      return fail(429, 'RATE_LIMITED', 'Too many AI requests. Try again in a minute.');
    }

    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    try {
      const mode = modeInstruction(body.data.mode, body.data.language, ids.length);
      const question = mode.question ?? body.data.question;
      const preference = await getSpeed(redis, userId);
      const run = async (pdfAsText: boolean) => {
        const loaded = await Promise.all(
          ids.map((id) => loadAttachment(files, userId, id, { pdfAsText })),
        );
        const result = await ai.chain.complete(
          { ...analyzeRequest(loaded, question, '', mode.maxTokens), preference },
          {
            signal: controller.signal,
            requestId: String(req.id),
            timeoutMs: 40_000,
            totalTimeoutMs: 60_000,
          },
        );
        return { text: result.text.trim() };
      };
      try {
        return await run(false);
      } catch (err) {
        // No PDF-capable provider answered: retry with the PDF's text layer.
        if (!(err instanceof AiUnavailableError)) throw err;
        return await run(true);
      }
    } catch (err) {
      if (err instanceof AttachmentError) return fail(err.status, err.code, err.message);
      if (err instanceof AiAbortedError) return fail(499, 'VALIDATION_FAILED', 'Cancelled.');
      if (err instanceof AiTimeoutError)
        return fail(503, 'AI_UNAVAILABLE', 'Flick took too long. Try again.');
      if (err instanceof AiUnavailableError) return fail(503, 'AI_UNAVAILABLE', err.message);
      req.log.error({ err: err instanceof Error ? err.name : 'unknown' }, 'analyze failed');
      return fail(503, 'AI_UNAVAILABLE', 'Flick could not read this file. Try again later.');
    }
  });
}
