import { TranscribeRequest, makeError } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { MediaError } from '../media/domain/errors.js';
import { findAttachment } from '../media/repo/attachments.js';
import { downloadUrl } from '../media/domain/uploads.js';
import { AI_OFF_MESSAGE, isAiAllowed } from './privacy.js';
import { quotaMessage, takeQuota } from './quota.js';
import {
  WhisperError,
  getTranscript,
  groqKey,
  messageForAttachment,
  saveTranscript,
  storageFor,
  whisper,
  isTranscribable,
  VIDEO_REFUSED,
  whisperLanguage,
} from './transcripts.js';

const STATUS = { rate_limited: 429, too_large: 400, unsupported: 400, unavailable: 503 } as const;
const CODE = {
  rate_limited: 'RATE_LIMITED',
  too_large: 'VALIDATION_FAILED',
  unsupported: 'VALIDATION_FAILED',
  unavailable: 'AI_UNAVAILABLE',
} as const;

/** POST /ai/transcribe: Groq Whisper on a voice message the caller is allowed to open. */
export function transcribeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const storage = storageFor(deps.config);
  if (storage) {
    app.addHook('onClose', () => {
      storage.client.destroy();
      storage.signer.destroy();
    });
  }

  app.post('/ai/transcribe', { preHandler: app.authenticate }, async (req, reply) => {
    const body = TranscribeRequest.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: makeError('VALIDATION_FAILED', 'attachment_id is required') });
    }
    if (!groqKey(deps.config) || !storage) {
      return reply
        .code(503)
        .send({ error: makeError('AI_UNAVAILABLE', 'Transcription is not configured.') });
    }
    try {
      const userId = req.auth!.userId;
      // Throws NOT_FOUND unless the caller owns the file or shares a chat with it.
      await downloadUrl(deps.db, storage, userId, body.data.attachment_id);
      const message = await messageForAttachment(deps.db, userId, body.data.attachment_id);
      const attachment = await findAttachment(deps.db, body.data.attachment_id);
      const mime = attachment?.verified_mime ?? attachment?.declared_mime ?? '';
      if (!isTranscribable(message?.type ?? null, mime)) {
        return reply.code(400).send({ error: makeError('VALIDATION_FAILED', VIDEO_REFUSED) });
      }
      // "Allow Flick to read this chat" off: no audio of that chat goes to the provider.
      if (message && !(await isAiAllowed(deps.db, userId, message.conversation_id))) {
        return reply.code(403).send({ error: makeError('FORBIDDEN', AI_OFF_MESSAGE) });
      }
      // Already transcribed (by auto-transcribe or by someone else in the chat): no second call.
      const existing = message ? await getTranscript(deps.db, message.id) : undefined;
      // Unless the user says the language is wrong and asks again.
      const hint = whisperLanguage(body.data.language);
      if (existing && !hint) return { text: existing.text };

      if (!(await takeQuota(deps.redis, userId, 'transcribe', deps.config.AI_DAILY_LIMIT))) {
        return reply
          .code(429)
          .send({ error: makeError('RATE_LIMITED', quotaMessage(deps.config.AI_DAILY_LIMIT)) });
      }
      const result = await whisper(deps, body.data.attachment_id, hint);
      if (message && result.text) {
        // Keep it: everyone in the chat sees it and search finds it.
        await saveTranscript(
          deps,
          message.id,
          result,
          (message.content as { duration_ms?: number } | null)?.duration_ms,
          Boolean(existing),
          userId,
        ).catch((err: unknown) => req.log.warn({ err }, 'saving transcript failed'));
      }
      return { text: result.text };
    } catch (err) {
      if (err instanceof MediaError) return reply.code(err.status).send(err.toBody());
      if (err instanceof WhisperError) {
        req.log.warn({ kind: err.kind }, 'transcribe refused');
        return reply.code(STATUS[err.kind]).send({ error: makeError(CODE[err.kind], err.message) });
      }
      req.log.error({ err }, 'transcribe failed');
      return reply
        .code(503)
        .send({ error: makeError('AI_UNAVAILABLE', 'Transcription failed. Try again later.') });
    }
  });
}
