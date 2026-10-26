import { GetObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeRequest, makeError } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { MediaError } from '../media/domain/errors.js';
import { createStorage } from '../media/domain/storage.js';
import { downloadUrl } from '../media/domain/uploads.js';
import { findAttachment } from '../media/repo/attachments.js';
import { messageForAttachment, saveTranscript } from './transcripts.js';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3-turbo';
/** Groq accepts files up to 25 MB; voice notes are far smaller. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** POST /ai/transcribe: Groq Whisper on a voice message the caller is allowed to open. */
export function transcribeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const storage = createStorage(deps.config);
  if (storage) {
    app.addHook('onClose', () => {
      storage.client.destroy();
      storage.signer.destroy();
    });
  }
  const apiKey = deps.config.GROQ_API_KEY_1 ?? deps.config.GROQ_API_KEY_2;

  app.post('/ai/transcribe', { preHandler: app.authenticate }, async (req, reply) => {
    const body = TranscribeRequest.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: makeError('VALIDATION_FAILED', 'attachment_id is required') });
    }
    if (!apiKey || !storage) {
      return reply
        .code(503)
        .send({ error: makeError('AI_UNAVAILABLE', 'Transcription is not configured.') });
    }
    try {
      // Throws NOT_FOUND unless the caller owns the file or shares a chat with it.
      await downloadUrl(deps.db, storage, req.auth!.userId, body.data.attachment_id);
      const row = await findAttachment(deps.db, body.data.attachment_id);
      if (!row || row.size_bytes > MAX_AUDIO_BYTES) {
        return reply.code(400).send({
          error: makeError('VALIDATION_FAILED', 'This audio is too large to transcribe.'),
        });
      }
      const object = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: row.object_key }),
      );
      const bytes = await object.Body!.transformToByteArray();
      const form = new FormData();
      form.append(
        'file',
        new Blob([bytes], { type: row.verified_mime ?? row.declared_mime }),
        'voice.webm',
      );
      form.append('model', WHISPER_MODEL);
      form.append('response_format', 'verbose_json');
      const res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        return reply
          .code(503)
          .send({ error: makeError('AI_UNAVAILABLE', 'Transcription failed. Try again later.') });
      }
      const data = (await res.json()) as { text?: string; language?: string; duration?: number };
      const text = (data.text ?? '').trim();
      // Keep it: everyone in the chat sees it and search finds it.
      const message = await messageForAttachment(
        deps.db,
        req.auth!.userId,
        body.data.attachment_id,
      );
      if (message && text) {
        await saveTranscript(
          deps,
          message.id,
          {
            text,
            language: data.language
              ? data.language[0]!.toUpperCase() + data.language.slice(1)
              : null,
            durationMs: typeof data.duration === 'number' ? Math.round(data.duration * 1000) : null,
          },
          (message.content as { duration_ms?: number } | null)?.duration_ms,
        ).catch((err: unknown) => req.log.warn({ err }, 'saving transcript failed'));
      }
      return { text };
    } catch (err) {
      if (err instanceof MediaError) return reply.code(err.status).send(err.toBody());
      req.log.error({ err }, 'transcribe failed');
      return reply
        .code(503)
        .send({ error: makeError('AI_UNAVAILABLE', 'Transcription failed. Try again later.') });
    }
  });
}
