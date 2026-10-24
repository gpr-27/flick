import type { FastifyInstance, FastifyReply, FastifyRequest, LogLevel } from 'fastify';
import { z } from 'zod';
import { findLinkPreviewError, type LinkPreviewErrorCode } from './errors.js';
import type { LinkPreviewService, PreviewResult } from './service.js';
import { hostForLog, MAX_URL_LENGTH } from './url.js';

/**
 * An async `onRequest` hook supplied by the host app. Resolve to let the
 * request through, or send a reply (e.g. 401 / 429) and `return reply` to stop it.
 */
export type LinkPreviewHook = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface LinkPreviewRoutesOptions {
  readonly service: LinkPreviewService;
  /** Authentication guard; runs first. Required so the proxy is never anonymous. */
  readonly authGuard: LinkPreviewHook;
  /** Rate limiter; runs after auth so it can key on the caller identity. */
  readonly rateLimit: LinkPreviewHook;
  /** Route path, default `/link-preview`. */
  readonly path?: string;
  /**
   * Log level for Fastify's built-in request/response lines on this route.
   * Defaults to "warn" because those lines include the query string, i.e.
   * the full target URL. The route logs its own host-only line instead.
   */
  readonly routeLogLevel?: LogLevel;
  /** Shapes the 200 body. Defaults to `{ preview, image? }`; hosts with their own wire format override it. */
  readonly serialize?: (result: PreviewResult) => unknown;
}

export const linkPreviewQuerySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(MAX_URL_LENGTH)
    .refine((v) => /^https?:\/\//i.test(v), { message: 'url must be an absolute http(s) URL' }),
  image: z.enum(['0', '1', 'true', 'false']).optional(),
});

export type LinkPreviewQuery = z.infer<typeof linkPreviewQuerySchema>;

/** Codes that come from the caller's input rather than the upstream site. */
const INPUT_CODES = new Set<LinkPreviewErrorCode>([
  'INVALID_URL',
  'BLOCKED_SCHEME',
  'BLOCKED_PORT',
  'BLOCKED_CREDENTIALS',
]);

/**
 * GET {path}?url=<target>[&image=1]
 *
 * 200 { preview: {url,title,description,siteName,imageUrl}, image?: {contentType, base64} }
 * 400 { error: "invalid_request" } for malformed input
 * 422 { error: "preview_unavailable" } for every fetch/policy failure. The
 *     specific reason is logged but not returned, so the endpoint cannot be
 *     used as an oracle to map which internal names or addresses exist.
 */
export function linkPreviewRoutes(
  fastify: FastifyInstance,
  opts: LinkPreviewRoutesOptions,
): Promise<void> {
  const path = opts.path ?? '/link-preview';

  fastify.route({
    method: 'GET',
    url: path,
    logLevel: opts.routeLogLevel ?? 'warn',
    onRequest: [opts.authGuard, opts.rateLimit],
    handler: async (request, reply) => {
      // Fastify's own request lines are muted by `routeLogLevel` because they
      // carry the query string; our host-only lines go to the instance logger.
      const log = fastify.log.child({ reqId: request.id });
      const parsed = linkPreviewQuerySchema.safeParse(request.query);
      void reply.header('cache-control', 'no-store');
      if (!parsed.success) {
        log.info({ linkPreview: { outcome: 'invalid_request' } }, 'link preview rejected');
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const host = hostForLog(parsed.data.url);
      const fetchImage = parsed.data.image === '1' || parsed.data.image === 'true';
      const started = performance.now();
      try {
        const result = await opts.service.getPreview(parsed.data.url, { fetchImage });
        log.info(
          {
            linkPreview: {
              host,
              outcome: 'ok',
              cached: result.cached,
              image: result.image !== undefined,
              ms: Math.round(performance.now() - started),
            },
          },
          'link preview served',
        );
        return await reply.code(200).send(
          opts.serialize?.(result) ?? {
            preview: result.preview,
            ...(result.image === undefined
              ? {}
              : {
                  image: {
                    contentType: result.image.contentType,
                    base64: result.image.data.toString('base64'),
                  },
                }),
          },
        );
      } catch (err) {
        const known = findLinkPreviewError(err);
        const code = known?.code ?? 'NETWORK_ERROR';
        log.info(
          {
            linkPreview: {
              host,
              outcome: 'failed',
              code,
              ms: Math.round(performance.now() - started),
            },
          },
          'link preview unavailable',
        );
        if (known === undefined)
          log.error(
            { errName: (err as Error | null)?.name ?? 'unknown' },
            'link preview internal error',
          );
        if (INPUT_CODES.has(code)) return reply.code(400).send({ error: 'invalid_request' });
        return reply.code(422).send({ error: 'preview_unavailable' });
      }
    },
  });
  return Promise.resolve();
}
