import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createSafeFetcher,
  DEFAULT_MAX_BYTES,
  DEFAULT_USER_AGENT,
  type SafeFetcher,
} from '../src/fetcher.js';
import { fixtureFetcher, html, HTML, htmlAccept, startFixture, type Fixture } from './fixture.js';

let fx: Fixture;
const opened: SafeFetcher[] = [];

function make(...args: Parameters<typeof fixtureFetcher>) {
  const made = fixtureFetcher(...args);
  opened.push(made.fetcher);
  return made;
}

beforeAll(async () => {
  fx = await startFixture();
  fx.route('/ok', (_req, res) => {
    html(res, HTML('<title>OK</title>'));
  });
  for (let i = 1; i <= 5; i++) {
    fx.route(`/r${i}`, (_req, res) =>
      res.writeHead(302, { location: i === 1 ? '/ok' : `/r${i - 1}` }).end(),
    );
  }
  fx.route('/to-loopback-literal', (_req, res) =>
    res.writeHead(302, { location: `http://127.0.0.1:${fx.port}/ok` }).end(),
  );
  fx.route('/to-localhost', (_req, res) =>
    res.writeHead(301, { location: `http://localhost:${fx.port}/ok` }).end(),
  );
  fx.route('/to-metadata', (_req, res) =>
    res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/iam/' }).end(),
  );
  fx.route('/to-decimal', (_req, res) =>
    res.writeHead(308, { location: 'http://2130706433/' }).end(),
  );
  fx.route('/to-v6-mapped', (_req, res) =>
    res.writeHead(302, { location: 'http://[::ffff:127.0.0.1]/' }).end(),
  );
  fx.route('/to-file', (_req, res) => res.writeHead(302, { location: 'file:///etc/passwd' }).end());
  fx.route('/to-creds', (_req, res) =>
    res.writeHead(302, { location: 'http://a:b@example.com/' }).end(),
  );
  fx.route('/to-internal-name', (_req, res) =>
    res.writeHead(302, { location: `http://internal.example:${fx.port}/ok` }).end(),
  );
  fx.route('/json', (_req, res) =>
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"a":1}'),
  );
  fx.route('/no-type', (_req, res) => {
    res.removeHeader('content-type');
    res.writeHead(200).end('<html></html>');
  });
  fx.route('/svg', (_req, res) =>
    res.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg/>'),
  );
  fx.route('/xhtml-lookalike', (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html-sandboxed' }).end('<html></html>'),
  );
  fx.route('/big-chunked', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const chunk = Buffer.alloc(64 * 1024, 'a');
    let sent = 0;
    const pump = () => {
      while (sent < 4 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) {
          res.once('drain', pump);
          return;
        }
      }
      res.end();
    };
    res.on('error', () => undefined);
    pump();
  });
  fx.route('/big-declared', (_req, res) => {
    const body = Buffer.alloc(DEFAULT_MAX_BYTES + 1, 'a');
    res
      .writeHead(200, { 'content-type': 'image/png', 'content-length': String(body.length) })
      .end(body);
  });
  const bomb = Buffer.alloc(20 * 1024 * 1024, 0x20);
  const gz = gzipSync(bomb);
  const br = brotliCompressSync(bomb);
  fx.route('/gzip-bomb', (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gz),
  );
  fx.route('/br-bomb', (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' }).end(br),
  );
  fx.route('/gzip-ok', (_req, res) =>
    res
      .writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      .end(gzipSync(HTML('<title>Zipped</title>'))),
  );
  fx.route('/br-ok', (_req, res) =>
    res
      .writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' })
      .end(brotliCompressSync(HTML('<title>Brotli</title>'))),
  );
  fx.route('/deflate', (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'deflate' }).end('x'),
  );
  fx.route('/slow-headers', (_req, res) => {
    const t = setTimeout(() => {
      html(res, HTML('<title>late</title>'));
    }, 2_000);
    res.on('close', () => {
      clearTimeout(t);
    });
  });
  fx.route('/slow-body', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const t = setInterval(() => res.write(' '), 50);
    res.on('close', () => {
      clearInterval(t);
    });
  });
  fx.route('/close', (_req, res) => {
    html(res, HTML('<title>closing</title>'), { connection: 'close' });
  });
  fx.route('/500', (_req, res) => res.writeHead(500, { 'content-type': 'text/html' }).end('boom'));
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((f) => f.close()));
});

afterAll(async () => {
  await fx.close();
});

describe('safe fetcher against the local fixture', () => {
  it('fetches HTML and sends a clear User-Agent', async () => {
    const { fetcher } = make();
    const res = await fetcher.fetch(fx.url('/ok'), htmlAccept);
    expect(res.status).toBe(200);
    expect(res.body?.toString()).toContain('<title>OK</title>');
    const hit = fx.hits.at(-1);
    expect(hit?.userAgent).toBe(DEFAULT_USER_AGENT);
    expect(hit?.host).toBe(`fixture.test:${fx.port}`);
  });

  it('without the test-only option the fixture is unreachable', async () => {
    const f = createSafeFetcher({
      resolver: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    });
    opened.push(f);
    // Non-standard port is refused first ...
    await expect(f.fetch(fx.url('/ok'), htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_PORT',
    });
    // ... and on a standard port, the loopback answer is refused.
    await expect(f.fetch('http://fixture.example/ok', htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
  });
});

describe('redirects', () => {
  it('follows up to 3 redirects', async () => {
    const { fetcher } = make();
    const res = await fetcher.fetch(fx.url('/r3'), htmlAccept);
    expect(res.redirects).toBe(3);
    expect(res.finalUrl.pathname).toBe('/ok');
  });

  it.each([
    ['/to-loopback-literal', 'BLOCKED_ADDRESS'],
    ['/to-metadata', 'BLOCKED_ADDRESS'],
    ['/to-file', 'BLOCKED_SCHEME'],
  ])('re-validates the hop %s -> %s', async (path, code) => {
    const { fetcher } = make();
    const before = fx.hits.length;
    await expect(fetcher.fetch(fx.url(path), htmlAccept)).rejects.toMatchObject({ code });
    // Only the first hop reached the fixture; the redirect target never did.
    expect(fx.hits.length - before).toBe(1);
  });

  it('re-resolves and re-vets the hostname of every hop', async () => {
    const { fetcher, calls } = make({ 'internal.example': ['10.1.2.3'] });
    await expect(fetcher.fetch(fx.url('/to-internal-name'), htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(calls).toContain('internal.example');
  });
});

describe('DNS answers', () => {
  it('blocks a hostname that resolves to a private IP', async () => {
    const { fetcher } = make({ 'private.example': ['192.168.1.10'] });
    await expect(fetcher.fetch(fx.url('/ok', 'private.example'), htmlAccept)).rejects.toMatchObject(
      {
        code: 'BLOCKED_ADDRESS',
      },
    );
  });

  it.each([['169.254.169.254'], ['::ffff:127.0.0.1']])(
    'blocks a hostname resolving to %s',
    async (address) => {
      const { fetcher } = make({ 'sneaky.example': [address] });
      await expect(
        fetcher.fetch(fx.url('/ok', 'sneaky.example'), htmlAccept),
      ).rejects.toMatchObject({
        code: 'BLOCKED_ADDRESS',
      });
    },
  );

  it('blocks when any answer in the set is private (round-robin trick)', async () => {
    const { fetcher } = make({ 'mixed.example': ['93.184.216.34', '10.0.0.5'] });
    await expect(fetcher.fetch(fx.url('/ok', 'mixed.example'), htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
  });

  it('maps resolver failures to DNS_FAILURE', async () => {
    const { fetcher } = make();
    await expect(
      fetcher.fetch(fx.url('/ok', 'nxdomain.example'), htmlAccept),
    ).rejects.toMatchObject({
      code: 'DNS_FAILURE',
    });
  });

  it('DNS rebinding: connects to the exact answer it vetted, and every new connection is re-vetted', async () => {
    // First answer is the (allowlisted) fixture; any later lookup "rebinds"
    // to an internal address, as an attacker-controlled DNS server would.
    const { fetcher, calls } = make({
      'rebind.test': (n) => (n === 1 ? ['127.0.0.1'] : ['10.0.0.1']),
    });

    const first = await fetcher.fetch(fx.url('/close', 'rebind.test'), htmlAccept);
    expect(first.body?.toString()).toContain('closing');
    // One lookup for one connection: no separate "check" resolution that the
    // attacker could answer differently from the "connect" resolution.
    expect(calls.filter((h) => h === 'rebind.test')).toHaveLength(1);
    // The request really went to the vetted address (the fixture on
    // 127.0.0.1) while keeping the original Host header.
    expect(fx.hits.at(-1)?.host).toBe(`rebind.test:${fx.port}`);

    // The server closed that socket; the next request needs a new connection,
    // whose lookup now returns 10.0.0.1 and is refused at connect time.
    const before = fx.hits.length;
    await expect(fetcher.fetch(fx.url('/ok', 'rebind.test'), htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(fx.hits.length).toBe(before);
  });
});

describe('body limits, content type and encoding', () => {
  it('stops reading an oversize HTML body at 512KB', async () => {
    const { fetcher } = make();
    const res = await fetcher.fetch(fx.url('/big-chunked'), htmlAccept);
    expect(res.truncated).toBe(true);
    expect(res.bytesRead).toBe(DEFAULT_MAX_BYTES);
    expect(res.body?.length).toBe(DEFAULT_MAX_BYTES);
  });

  it('errors on oversize bodies in strict mode, using the declared length', async () => {
    const { fetcher } = make();
    await expect(
      fetcher.fetch(fx.url('/big-declared'), {
        acceptHeader: 'image/png',
        acceptMime: (m) => m === 'image/png',
        onOversize: 'error',
        collect: true,
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it.each(['/gzip-bomb'])('caps decompressed output of %s', async (path) => {
    const { fetcher } = make();
    const res = await fetcher.fetch(fx.url(path), htmlAccept);
    expect(res.truncated).toBe(true);
    expect(res.bytesRead).toBe(DEFAULT_MAX_BYTES);
  });

  it.each([
    ['/gzip-ok', 'Zipped'],
    ['/br-ok', 'Brotli'],
  ])('decodes %s', async (path, title) => {
    const { fetcher } = make();
    const res = await fetcher.fetch(fx.url(path), htmlAccept);
    expect(res.body?.toString()).toContain(title);
  });

  it.each(['/json', '/svg'])('rejects non-HTML content type at %s', async (path) => {
    const { fetcher } = make();
    await expect(fetcher.fetch(fx.url(path), htmlAccept)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    });
  });

  it('maps non-2xx to HTTP_ERROR', async () => {
    const { fetcher } = make();
    await expect(fetcher.fetch(fx.url('/500'), htmlAccept)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
  });
});

describe('timeouts', () => {
  it('times out waiting for headers', async () => {
    const { fetcher } = make({}, { totalTimeoutMs: 300 });
    const started = Date.now();
    await expect(fetcher.fetch(fx.url('/slow-headers'), htmlAccept)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('enforces a total budget against a slow-drip body', async () => {
    const { fetcher } = make({}, { totalTimeoutMs: 300 });
    const started = Date.now();
    await expect(fetcher.fetch(fx.url('/slow-body'), htmlAccept)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
