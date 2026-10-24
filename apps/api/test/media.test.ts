import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { Redis } from '../src/redis.js';
import { objectKey, sameType, sanitizeFileName } from '../src/modules/media/domain/rules.js';
import { gifRoutes } from '../src/modules/extras/http/gifs.js';
import { TEST_ENV } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('upload rules', () => {
  it('sanitises file names and never puts them in the object key', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\my photo<1>.png')).toBe('my photo_1_.png');
    expect(sanitizeFileName('...')).toBeNull();
    expect(objectKey('message', 'user-1', 'att-1')).toBe('messages/user-1/att-1');
  });

  it('treats different names of the same audio container as the same type', () => {
    expect(sameType('audio/mp4', 'video/mp4')).toBe(true);
    expect(sameType('audio/webm', 'video/webm')).toBe(true);
    expect(sameType('image/png', 'image/jpeg')).toBe(false);
  });
});

describe('uploads without object storage settings', () => {
  it('answers 503 and names the missing variable', async () => {
    const config = loadConfig(TEST_ENV);
    const app = await buildApp({
      config,
      logger: createLogger('silent'),
      db: createDb(config.DATABASE_URL, 1),
      redis: new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false }),
      checks: [],
      isShuttingDown: () => false,
      authenticate: (req) => {
        req.auth = { userId: 'u1', deviceId: 'd1' };
        return Promise.resolve();
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/media/presign',
      payload: { purpose: 'message', mime: 'image/png', size: 10 },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<ErrBody>().error.message).toContain('S3_BUCKET');
    await app.close();
  });
});

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => Promise.resolve(void store.set(k, v)).then(() => 'OK' as const),
  };
}

async function gifApp(apiKey: string | undefined, redis = fakeRedis()) {
  const app = Fastify();
  app.decorate('authenticate', () => Promise.resolve());
  gifRoutes(app, { apiKey, redis: redis });
  await app.ready();
  return app;
}

interface ErrBody {
  error: { message: string; code: string };
}

const giphyBody = {
  data: [
    {
      id: 'abc',
      title: 'cat',
      images: {
        original: { url: 'https://media.giphy.com/o.gif', width: '480', height: '270' },
        fixed_width_small: { url: 'https://media.giphy.com/s.gif', width: '100', height: '56' },
        extra: 'ignored',
      },
    },
    { id: 'broken' },
  ],
};

describe('GIF proxy', () => {
  it('returns only contract fields and serves repeats from the cache', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(giphyBody)));
    vi.stubGlobal('fetch', fetchMock);
    const app = await gifApp('secret-key');

    const first = await app.inject('/gifs/search?q=Cat');
    expect(first.json()).toEqual({
      items: [
        {
          id: 'abc',
          title: 'cat',
          url: 'https://media.giphy.com/o.gif',
          preview_url: 'https://media.giphy.com/s.gif',
          width: 480,
          height: 270,
        },
      ],
    });
    const second = await app.inject('/gifs/search?q=cat'); // same query, different case
    expect(second.json()).toEqual(first.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 503 naming GIPHY_API_KEY when the key is missing, without calling GIPHY', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await (await gifApp(undefined)).inject('/gifs/trending');
    expect(res.statusCode).toBe(503);
    expect(res.json<ErrBody>().error.message).toContain('GIPHY_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a GIPHY 429 on as 429 and does not cache it', async () => {
    const redis = fakeRedis();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('slow down', { status: 429 }))),
    );
    const res = await (await gifApp('k', redis)).inject('/gifs/trending');
    expect(res.statusCode).toBe(429);
    expect(res.json<ErrBody>().error.code).toBe('RATE_LIMITED');
    expect(redis.store.size).toBe(0);
  });

  it('never exposes the API key in the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(giphyBody))),
    );
    const res = await (await gifApp('secret-key')).inject('/gifs/trending');
    expect(res.body).not.toContain('secret-key');
  });
});

describe('link preview route', () => {
  it('rejects anonymous callers', async () => {
    const config = loadConfig(TEST_ENV);
    const app = await buildApp({
      config,
      logger: createLogger('silent'),
      db: createDb(config.DATABASE_URL, 1),
      redis: new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false }),
      checks: [],
      isShuttingDown: () => false,
    });
    const res = await app.inject('/link-preview?url=https%3A%2F%2Fexample.com');
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
