import { GifSearchQuery, makeError, type GifResult } from '@chat/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Redis } from '../../../redis.js';

const GIPHY = 'https://api.giphy.com/v1';
const CACHE_SECONDS = 5 * 60; // the free key allows about 100 calls an hour
const TIMEOUT_MS = 4_000;

export interface GifDeps {
  apiKey: string | undefined;
  redis: Pick<Redis, 'get' | 'set'>;
}

const image = z.object({
  url: z.url(),
  width: z.coerce.number().int().positive(),
  height: z.coerce.number().int().positive(),
});
const giphyItem = z.object({
  id: z.string().min(1).max(64),
  title: z.string().default(''),
  images: z.object({ original: image, fixed_width_small: image.optional() }),
});

/** Keeps only the fields the contract defines. Items GIPHY returns in an unexpected shape are skipped. */
function toResults(body: unknown): z.infer<typeof GifResult>[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const item = giphyItem.safeParse(raw);
    if (!item.success) return [];
    const { id, title, images } = item.data;
    return [
      {
        id,
        title,
        url: images.original.url,
        preview_url: (images.fixed_width_small ?? images.original).url,
        width: images.original.width,
        height: images.original.height,
      },
    ];
  });
}

function fail(
  reply: FastifyReply,
  status: number,
  code: 'SERVICE_UNAVAILABLE' | 'RATE_LIMITED' | 'TIMEOUT' | 'VALIDATION_FAILED',
  message: string,
) {
  return reply.code(status).send({ error: makeError(code, message) });
}

async function readCache(redis: GifDeps['redis'], key: string): Promise<string | null> {
  // The cache only saves GIPHY calls; if Redis is down we go to GIPHY instead of failing.
  return redis.get(key).catch(() => null);
}

export function gifRoutes(app: FastifyInstance, deps: GifDeps): void {
  async function handle(reply: FastifyReply, query: unknown, endpoint: 'search' | 'trending') {
    if (!deps.apiKey)
      return fail(
        reply,
        503,
        'SERVICE_UNAVAILABLE',
        'GIF search is disabled: GIPHY_API_KEY is not set',
      );

    const parsed = GifSearchQuery.safeParse(query);
    if (!parsed.success || (endpoint === 'search' && !parsed.data.q)) {
      return fail(
        reply,
        400,
        'VALIDATION_FAILED',
        parsed.success ? 'q is required' : parsed.error.issues[0]!.message,
      );
    }
    const { kind, limit } = parsed.data;
    const q = endpoint === 'search' ? parsed.data.q!.toLowerCase() : undefined;

    const cacheKey = `gifs:${kind}:${endpoint}:${limit}:${q ?? ''}`;
    const cached = await readCache(deps.redis, cacheKey);
    if (cached) return reply.type('application/json').send(cached);

    const path = `${GIPHY}/${kind === 'sticker' ? 'stickers' : 'gifs'}/${endpoint}`;
    const params = new URLSearchParams({
      api_key: deps.apiKey,
      limit: String(limit),
      rating: 'pg-13',
    });
    if (q) params.set('q', q);

    let res: Response;
    try {
      res = await fetch(`${path}?${params.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      app.log.warn({ err: (error as Error).name }, 'giphy request failed'); // never log the URL: it holds the key
      return (error as Error).name === 'TimeoutError'
        ? fail(reply, 504, 'TIMEOUT', 'GIF search timed out')
        : fail(reply, 503, 'SERVICE_UNAVAILABLE', 'GIF search is unavailable');
    }

    if (res.status === 429) {
      void reply.header('retry-after', res.headers.get('retry-after') ?? '60');
      return fail(reply, 429, 'RATE_LIMITED', 'GIF search is rate limited, try again later');
    }
    if (!res.ok) return fail(reply, 503, 'SERVICE_UNAVAILABLE', 'GIF search is unavailable');

    const payload = JSON.stringify({ items: toResults(await res.json().catch(() => null)) });
    await deps.redis.set(cacheKey, payload, 'EX', CACHE_SECONDS).catch(() => undefined);
    return reply.type('application/json').send(payload);
  }

  app.get('/gifs/search', { preHandler: app.authenticate }, (req, reply) =>
    handle(reply, req.query, 'search'),
  );
  app.get('/gifs/trending', { preHandler: app.authenticate }, (req, reply) =>
    handle(reply, req.query, 'trending'),
  );
}
