import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryPreviewCache,
  NEGATIVE_TTL_SECONDS,
  PREVIEW_TTL_SECONDS,
  type CacheEntry,
  type PreviewCache,
} from '../src/cache.js';
import { createLinkPreviewService, type LinkPreviewService } from '../src/service.js';
import { cacheKeyFor } from '../src/url.js';
import { fixtureFetcher, html, HTML, startFixture, type Fixture } from './fixture.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

let fx: Fixture;
const services: LinkPreviewService[] = [];
const fetchers: { close(): Promise<void> }[] = [];

class RecordingCache implements PreviewCache {
  readonly inner = new MemoryPreviewCache();
  readonly sets: { key: string; entry: CacheEntry; ttl: number }[] = [];
  get(key: string) {
    return this.inner.get(key);
  }
  async set(key: string, entry: CacheEntry, ttl: number) {
    this.sets.push({ key, entry, ttl });
    await this.inner.set(key, entry, ttl);
  }
}

function service(
  cache: PreviewCache = new MemoryPreviewCache(),
  extra: Parameters<typeof fixtureFetcher>[0] = {},
) {
  const { fetcher } = fixtureFetcher(extra);
  fetchers.push(fetcher);
  const svc = createLinkPreviewService({ fetcher, cache });
  services.push(svc);
  return svc;
}

function hitsFor(path: string): number {
  return fx.hits.filter((h) => h.path === path).length;
}

beforeAll(async () => {
  fx = await startFixture();
  fx.route('/article', (_req, res) => {
    html(
      res,
      HTML(
        `<title>Article</title><meta property="og:description" content="About things"><meta property="og:image" content="/img.png">`,
      ),
    );
  });
  fx.route('/slow', (_req, res) => {
    setTimeout(() => {
      html(res, HTML('<title>Slow one</title>'));
    }, 150);
  });
  fx.route('/empty', (_req, res) => {
    html(res, HTML(''));
  });
  fx.route('/json', (_req, res) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}'),
  );
  fx.route('/img.png', (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG));
  fx.route('/with-svg', (_req, res) => {
    html(res, HTML('<title>svg</title><meta property="og:image" content="/fake.png">'));
  });
  fx.route('/fake.png', (_req, res) =>
    res.writeHead(200, { 'content-type': 'image/png' }).end('<svg onload=alert(1)>'),
  );
  fx.route('/huge-head', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write('<html><head><title>Huge</title>');
    res.end(`<!--${'x'.repeat(2 * 1024 * 1024)}-->`);
  });
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
  await Promise.all(fetchers.splice(0).map((f) => f.close()));
});

afterAll(async () => {
  await fx.close();
});

describe('link preview service', () => {
  it('returns a parsed preview', async () => {
    const svc = service();
    const result = await svc.getPreview(fx.url('/article'));
    expect(result.cached).toBe(false);
    expect(result.preview).toEqual({
      url: fx.url('/article'),
      title: 'Article',
      description: 'About things',
      siteName: null,
      imageUrl: fx.url('/img.png'),
    });
    expect(result.image).toBeUndefined();
    expect(hitsFor('/img.png')).toBe(0); // images are not fetched by default
  });

  it('serves the second request from cache with a 24h TTL', async () => {
    const cache = new RecordingCache();
    const svc = service(cache);
    const before = hitsFor('/article');
    await svc.getPreview(fx.url('/article'));
    const second = await svc.getPreview(`${fx.url('/article')}#ignored-fragment`);
    expect(second.cached).toBe(true);
    expect(hitsFor('/article') - before).toBe(1);
    expect(cache.sets).toHaveLength(1);
    expect(cache.sets[0]?.ttl).toBe(PREVIEW_TTL_SECONDS);
    expect(cache.sets[0]?.key).toBe(cacheKeyFor(new URL(fx.url('/article'))));
  });

  it('single-flight: concurrent requests for one URL share one upstream fetch', async () => {
    const svc = service();
    const before = hitsFor('/slow');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.getPreview(fx.url('/slow'))),
    );
    expect(hitsFor('/slow') - before).toBe(1);
    for (const r of results) expect(r.preview.title).toBe('Slow one');
  });

  it('caches failures negatively for 1h', async () => {
    const cache = new RecordingCache();
    const svc = service(cache);
    const before = hitsFor('/json');
    await expect(svc.getPreview(fx.url('/json'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    });
    await expect(svc.getPreview(fx.url('/json'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    });
    expect(hitsFor('/json') - before).toBe(1);
    expect(cache.sets).toEqual([
      {
        key: expect.any(String) as string,
        entry: { ok: false, code: 'UNSUPPORTED_CONTENT_TYPE' },
        ttl: NEGATIVE_TTL_SECONDS,
      },
    ]);
  });

  it('rejects policy violations on the submitted URL without caching', async () => {
    const cache = new RecordingCache();
    const svc = service(cache);
    await expect(svc.getPreview('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(cache.sets).toHaveLength(0);
  });

  it('stops reading once the head is parsed, even for a huge page', async () => {
    const svc = service();
    const result = await svc.getPreview(fx.url('/huge-head'));
    expect(result.preview.title).toBe('Huge');
  });

  it('optionally fetches the image through the safe fetcher, sniffed and size-capped', async () => {
    const svc = service();
    const result = await svc.getPreview(fx.url('/article'), { fetchImage: true });
    expect(result.image?.contentType).toBe('image/png');
    expect(result.image?.data.equals(PNG)).toBe(true);
    // Cached under its own key, including the image bytes.
    const again = await svc.getPreview(fx.url('/article'), { fetchImage: true });
    expect(again.cached).toBe(true);
    expect(again.image?.data.equals(PNG)).toBe(true);
  });

  it('a cache outage degrades to a live fetch', async () => {
    const broken: PreviewCache = {
      get: () => Promise.reject(new Error('redis down')),
      set: () => Promise.reject(new Error('redis down')),
    };
    const svc = service(broken);
    const result = await svc.getPreview(fx.url('/article'));
    expect(result.preview.title).toBe('Article');
  });
});
