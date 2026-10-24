import { describe, expect, it } from 'vitest';
import { LinkPreviewError } from '../src/errors.js';
import { createSafeFetcher } from '../src/fetcher.js';
import { cacheKeyFor, normalizeUrl, validateUrl } from '../src/url.js';
import { htmlAccept, mockResolver } from './fixture.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof LinkPreviewError ? err.code : 'NOT_LINK_PREVIEW_ERROR';
  }
}

describe('validateUrl', () => {
  it('rejects scheme', () => {
    for (const url of [
      'ftp://example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'gopher://example.com/',
      'ws://example.com/',
      'blob:https://example.com/x',
    ]) {
      expect(codeOf(() => validateUrl(url))).toBe('BLOCKED_SCHEME');
    }
  });

  it('rejects port in', () => {
    for (const url of [
      'http://example.com:8080/',
      'https://example.com:22/',
      'http://example.com:6379/',
      'http://example.com:1/',
      'https://example.com:8443/',
    ]) {
      expect(codeOf(() => validateUrl(url))).toBe('BLOCKED_PORT');
    }
  });

  it('rejects credentials in', () => {
    for (const url of [
      'http://user:pass@example.com/',
      'http://user@example.com/',
      'https://:secret@example.com/',
      'http://example.com@127.0.0.1/',
    ]) {
      expect(codeOf(() => validateUrl(url))).toMatch(/BLOCKED_CREDENTIALS/);
    }
  });

  // Every one of these spells a loopback, private or metadata address.
  const literalTricks = [
    'http://127.0.0.1/',
    'http://2130706433/', // decimal
    'http://0x7f000001/', // hex
    'http://0x7f.0x0.0x0.0x1/', // dotted hex
    'http://0x7f.1/', // hex + short form
    'http://017700000001/', // octal
    'http://0177.0.0.1/', // dotted octal
    'http://0177.0000.0000.0001/',
    'http://127.1/', // short form
    'http://127.0.1/',
    'http://127.0.0.1./', // trailing dot
    'http://１２７.０.０.１/', // full-width digits
    'http://0/',
    'http://0.0.0.0/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2852039166/', // 169.254.169.254 in decimal
    'http://0xa9fea9fe/', // 169.254.169.254 in hex
    'http://0251.0376.0251.0376/', // 169.254.169.254 in octal
    'http://10.0.0.1/',
    'http://012.0.0.1/', // 10.0.0.1 octal
    'http://167772161/', // 10.0.0.1 decimal
    'http://192.168.1.1/',
    'http://3232235777/', // 192.168.1.1 decimal
    'http://0xc0a80101/', // 192.168.1.1 hex
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[64:ff9b::127.0.0.1]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::127.0.0.1]/',
  ];

  it('blocks every IP literal trick', () => {
    for (const url of literalTricks) {
      expect(
        codeOf(() => validateUrl(url)),
        url,
      ).toBe('BLOCKED_ADDRESS');
    }
  });

  it('blocks reserved hostname', () => {
    for (const url of [
      'http://localhost/',
      'http://LOCALHOST./',
      'http://foo.localhost/',
      'http://printer.local/',
      'http://db.internal/',
      'http://intranet/',
      'http://router.home.arpa/',
    ]) {
      expect(codeOf(() => validateUrl(url))).toBe('BLOCKED_HOST');
    }
  });

  it('rejects junk and over-long URLs', () => {
    expect(codeOf(() => validateUrl('not a url'))).toBe('INVALID_URL');
    expect(codeOf(() => validateUrl(''))).toBe('INVALID_URL');
    expect(codeOf(() => validateUrl(`https://example.com/${'a'.repeat(3000)}`))).toBe(
      'INVALID_URL',
    );
  });
});

describe('IP literal tricks never reach DNS or the network', () => {
  const fetcher = createSafeFetcher({
    resolver: () => Promise.reject(new Error('resolver must not be called for literals')),
  });

  it('IP literal tricks are rejected without DNS', async () => {
    for (const url of [
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://[::ffff:127.0.0.1]/',
      'http://0xa9fea9fe/latest/meta-data/',
    ]) {
      await expect(fetcher.fetch(url, htmlAccept)).rejects.toMatchObject({
        code: 'BLOCKED_ADDRESS',
      });
    }
  });

  it('hostnames are resolved through the injected resolver and the answer is vetted', async () => {
    const { resolver, calls } = mockResolver({ 'evil.example': ['127.0.0.1'] });
    const f = createSafeFetcher({ resolver });
    await expect(f.fetch('http://evil.example/', htmlAccept)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(calls).toEqual(['evil.example']);
    await f.close();
  });
});

describe('normalisation and keys', () => {
  it('drops fragment, default port and trailing dot; lower-cases host', () => {
    expect(normalizeUrl(new URL('HTTPS://Example.COM.:443/a?b=1#frag'))).toBe(
      'https://example.com/a?b=1',
    );
  });

  it('cache key is the sha256 hex of the normalised URL', () => {
    const a = cacheKeyFor(new URL('https://example.com/a#x'));
    const b = cacheKeyFor(new URL('https://EXAMPLE.com:443/a'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKeyFor(new URL('https://example.com/a'), 'img')).toBe(`${a}:img`);
  });
});
