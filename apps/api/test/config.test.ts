import { describe, expect, it } from 'vitest';
import { mediaUrl } from '../src/avatars.js';
import { loadConfig, s3Config } from '../src/config.js';
import { TEST_ENV } from './helpers.js';

describe('loadConfig', () => {
  it('fills in defaults', () => {
    const config = loadConfig(TEST_ENV);
    expect(config.API_PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(s3Config(config)).toBeUndefined();
  });

  it('listens on PORT (set by Render) unless API_PORT is given', () => {
    expect(loadConfig({ ...TEST_ENV, PORT: '10000' }).API_PORT).toBe(10000);
    expect(loadConfig({ ...TEST_ENV, PORT: '10000', API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('refuses production without CORS_ORIGINS', () => {
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(
      loadConfig({ ...TEST_ENV, NODE_ENV: 'production', CORS_ORIGINS: 'https://flick.vercel.app' })
        .CORS_ORIGINS,
    ).toEqual(['https://flick.vercel.app']);
  });

  it('builds avatar links from S3_PUBLIC_URL when set', () => {
    const base = { ...TEST_ENV, S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'media' };
    expect(mediaUrl(loadConfig(base), 'a/b')).toBe('http://minio:9000/media/a/b');
    const cdn = loadConfig({ ...base, S3_PUBLIC_URL: 'https://pub-x.r2.dev/' });
    expect(mediaUrl(cdn, 'a/b')).toBe('https://pub-x.r2.dev/a/b');
  });

  it('names every missing variable and the dependency it belongs to', () => {
    expect(() => loadConfig({})).toThrow(
      [
        'Invalid API configuration:',
        '  - DATABASE_URL (PostgreSQL, e.g. postgres://chat:chat@localhost:5432/chat): is required but not set',
        '  - REDIS_URL (Redis, e.g. redis://localhost:6379): is required but not set',
      ].join('\n'),
    );
  });

  it('explains invalid values', () => {
    expect(() => loadConfig({ ...TEST_ENV, API_PORT: 'abc', DATABASE_URL: 'mysql://x' })).toThrow(
      /API_PORT \(HTTP server\): .+\n {2}- DATABASE_URL \(PostgreSQL/,
    );
  });

  it('treats empty values as unset and parses lists', () => {
    const config = loadConfig({
      ...TEST_ENV,
      API_PORT: '',
      CORS_ORIGINS: 'https://a.test, https://b.test',
    });
    expect(config.API_PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('E2E_FAKE_AUTH', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('is off by default and allowed outside production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).E2E_FAKE_AUTH).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test', E2E_FAKE_AUTH: 'true' }).E2E_FAKE_AUTH).toBe(
      true,
    );
  });

  it('is refused in production, so the test login can never be live', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', E2E_FAKE_AUTH: 'true' })).toThrow(
      /E2E_FAKE_AUTH/,
    );
  });
});
