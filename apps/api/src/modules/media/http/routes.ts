import { AttachmentParams, DownloadUrlQuery, PresignUploadRequest } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../../app.js';
import { MediaError } from '../domain/errors.js';
import { createStorage, missingStorageVariable } from '../domain/storage.js';
import { completeUpload, downloadUrl, presignUpload } from '../domain/uploads.js';

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new MediaError('VALIDATION_FAILED', result.error.issues[0]?.message ?? 'Invalid request');
  }
  return result.data;
}

export function mediaRoutes(app: FastifyInstance, deps: AppDeps): void {
  const storage = createStorage(deps.config);
  if (storage) {
    app.addHook('onClose', () => {
      storage.client.destroy();
      storage.signer.destroy();
    });
  }

  // Its own scope so the error handler below only applies to the media routes.
  void app.register((scope, _options, done) => {
    scope.setErrorHandler((error, req, reply) => {
      if (!(error instanceof MediaError)) throw error; // the app-wide handler deals with it
      return reply.code(error.status).send(error.toBody());
    });

    scope.addHook('preHandler', app.authenticate);

    // Without storage settings only uploads are unavailable, and the error says which one to set.
    scope.addHook('preHandler', () => {
      const missing = missingStorageVariable(deps.config);
      if (!missing) return Promise.resolve();
      return Promise.reject(
        new MediaError('SERVICE_UNAVAILABLE', `Uploads are disabled: ${missing} is not set`),
      );
    });

    scope.post(
      '/media/presign',
      { config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
      (req) =>
        presignUpload(deps.db, storage!, req.auth!.userId, parse(PresignUploadRequest, req.body)),
    );

    scope.post('/media/:attachment_id/complete', async (req) => {
      const { attachment_id } = parse(AttachmentParams, req.params);
      return completeUpload(deps.db, storage!, req.auth!.userId, attachment_id);
    });

    scope.get('/media/:attachment_id/url', async (req) => {
      const { attachment_id } = parse(AttachmentParams, req.params);
      const { preview } = parse(DownloadUrlQuery, req.query);
      return downloadUrl(deps.db, storage!, req.auth!.userId, attachment_id, {
        preview: preview === '1',
      });
    });
    done();
  });
}
