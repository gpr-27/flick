import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkPreviewRoutes, type LinkPreviewHook } from '../src/plugin.js';
import { createLinkPreviewService, type LinkPreviewService } from '../src/service.js';
import { fixtureFetcher, html, HTML, startFixture, type Fixture } from './fixture.js';

let fx: Fixture;
let app: FastifyInstance;
let svc: LinkPreviewService;
const logLines: string[] = [];
let rateLimited = false;

const SECRET_PATH = '/private/doc-7f3a9?token=s3cr3t-value';

beforeAll(async () => {
  fx = await startFixture();
  fx.route('/private/doc-7f3a9', (_req, res) => {
    html(res, HTML('<title>Shared doc</title><meta property="og:image" content="/i.gif">'));
  });
  fx.route('/i.gif', (_req, res) =>
    res
      .writeHead(200, { 'content-type': 'image/gif' })
      .end(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')),
  );
  fx.route('/json', (_req, res) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}'),
  );

  const { fetcher } = fixtureFetcher({ 'internal.example': ['10.0.0.1'] });
  svc = createLinkPreviewService({ fetcher });

  const authGuard: LinkPreviewHook = async (request, reply) => {
    if (request.headers.authorization !== 'Bearer good') {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return undefined;
  };
  const rateLimit: LinkPreviewHook = async (_request, reply) => {
    if (rateLimited) return reply.code(429).send({ error: 'rate_limited' });
    return undefined;
  };

  app = Fastify({
    logger: {
      level: 'trace',
      stream: {
        write: (line: string) => {
          logLines.push(line);
        },
      },
    },
  });
  await app.register(linkPreviewRoutes, { service: svc, authGuard, rateLimit });
  await app.ready();
  fetcherClose = () => fetcher.close();
});

let fetcherClose: () => Promise<void> = () => Promise.resolve();

afterAll(async () => {
  await app.close();
  await svc.close();
  await fetcherClose();
  await fx.close();
});

const auth = { authorization: 'Bearer good' };

function get(url: string, headers: Record<string, string> = auth) {
  return app.inject({
    method: 'GET',
    url: `/link-preview?url=${encodeURIComponent(url)}`,
    headers,
  });
}

describe('GET /link-preview', () => {
  it('requires auth (guard runs before anything else)', async () => {
    const before = fx.hits.length;
    const res = await get(fx.url('/json'), {});
    expect(res.statusCode).toBe(401);
    expect(fx.hits.length).toBe(before);
  });

  it('applies the rate limit hook', async () => {
    rateLimited = true;
    try {
      const res = await get(fx.url('/json'));
      expect(res.statusCode).toBe(429);
    } finally {
      rateLimited = false;
    }
  });

  it.each([
    '/link-preview',
    '/link-preview?url=notaurl',
    `/link-preview?url=${encodeURIComponent('ftp://example.com/')}`,
  ])('400 for invalid query %s', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('returns the preview', async () => {
    const res = await get(fx.url(SECRET_PATH));
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<{ preview: { title: string; imageUrl: string }; image?: unknown }>();
    expect(body.preview.title).toBe('Shared doc');
    expect(body.preview.imageUrl).toBe(fx.url('/i.gif'));
    expect(body.image).toBeUndefined();
  });

  it('returns image bytes when image=1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/link-preview?url=${encodeURIComponent(fx.url(SECRET_PATH))}&image=1`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ image: { contentType: string; base64: string } }>();
    expect(body.image.contentType).toBe('image/gif');
    expect(Buffer.from(body.image.base64, 'base64').subarray(0, 6).toString('latin1')).toBe(
      'GIF89a',
    );
  });

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://localhost/'])(
    'uniform 422 for blocked target %s (no oracle)',
    async (target) => {
      const res = await get(target);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'preview_unavailable' });
    },
  );

  it('uniform 422 for upstream failures', async () => {
    const res = await get(fx.url('/json'));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'preview_unavailable' });
  });

  it('never logs full URLs, only the host', async () => {
    logLines.length = 0;
    await get(fx.url(SECRET_PATH));
    await get(`https://internal.example${SECRET_PATH}`);
    const all = logLines.join('\n');
    expect(all).toContain('fixture.test');
    expect(all).toContain('internal.example');
    expect(all).not.toContain('doc-7f3a9');
    expect(all).not.toContain('s3cr3t');
    expect(all).not.toContain(encodeURIComponent('/private/doc-7f3a9'));
    expect(all).toContain('BLOCKED_ADDRESS');
  });
});
