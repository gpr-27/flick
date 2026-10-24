import { LinkPreview } from '@chat/contracts';
import { RedisPreviewCache, createLinkPreviewService, linkPreviewRoutes } from '@chat/link-preview';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { gifRoutes } from './gifs.js';

export function extrasRoutes(app: FastifyInstance, deps: AppDeps): void {
  gifRoutes(app, { apiKey: deps.config.GIPHY_API_KEY, redis: deps.redis });

  const service = createLinkPreviewService({ cache: new RedisPreviewCache(deps.redis) });
  app.addHook('onClose', () => service.close());

  void linkPreviewRoutes(app, {
    service,
    authGuard: app.authenticate,
    // Runs after auth, so the limit is per user, not per IP.
    rateLimit: app.rateLimit({
      max: 30,
      timeWindow: 60_000,
      keyGenerator: (req) => req.auth?.userId ?? req.ip,
    }),
    // The package shapes its own JSON; the shared contract uses snake_case names.
    serialize: ({ preview }) =>
      LinkPreview.parse({
        url: preview.url,
        title: preview.title,
        description: preview.description,
        image_url: preview.imageUrl,
        site_name: preview.siteName,
      }),
  });
}
