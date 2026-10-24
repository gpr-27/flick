import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const up = (name: string) => ({ name, critical: true, check: () => Promise.resolve() });
const down = (name: string, critical: boolean) => ({
  name,
  critical,
  check: () => Promise.reject(new Error(`${name} unreachable`)),
});

describe('health', () => {
  it('liveness answers even when dependencies are down', async () => {
    const app = await testApp([down('postgres', true)]);
    const res = await app.inject('/health/live');
    expect(res.statusCode).toBe(200);
  });

  it('readiness is 200 when dependencies are up', async () => {
    const app = await testApp([up('postgres'), up('redis')]);
    const res = await app.inject('/health/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready' });
  });

  it('readiness stays 200 but says degraded when an optional dependency is down', async () => {
    const app = await testApp([up('postgres'), down('object-storage', false)]);
    const res = await app.inject('/health/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'degraded',
      checks: [
        { name: 'postgres', ok: true },
        { name: 'object-storage', ok: false, error: 'object-storage unreachable' },
      ],
    });
  });

  it('readiness is 503 when a critical dependency is down or during shutdown', async () => {
    const broken = await testApp([down('postgres', true)]);
    expect((await broken.inject('/health/ready')).statusCode).toBe(503);
    const stopping = await testApp([up('postgres')], true);
    const res = await stopping.inject('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'not_ready', shuttingDown: true });
  });
});

describe('metrics', () => {
  it('exposes Prometheus metrics labelled by route template, not raw URL', async () => {
    const app = await testApp();
    await app.inject('/health/live');
    await app.inject('/no/such/page/12345');
    const res = await app.inject('/metrics');
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# TYPE eventloop_lag_seconds gauge');
    expect(res.body).toContain('# TYPE rate_limit_rejections_total counter');
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{service="api",route="GET \/health\/live",status="200"\}/,
    );
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{service="api",route="unmatched",status="404"\}/,
    );
    expect(res.body).not.toContain('12345');
  });
});

describe('security', () => {
  it('sets security headers and only allows configured CORS origins', async () => {
    const app = await testApp();
    const allowed = await app.inject({
      url: '/health/live',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await app.inject({
      url: '/health/live',
      headers: { origin: 'https://evil.test' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a cross-origin preflight for PATCH and DELETE with our headers', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/users/me',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,x-device-id',
      },
    });
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH.*DELETE/);
    expect(res.headers['access-control-allow-headers']).toBe('authorization,x-device-id');
  });

  it('lets a web app on another origin call DELETE and PATCH (browser preflight)', async () => {
    const app = await testApp();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/conversations/x/members/y',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'DELETE' },
    });
    expect(preflight.headers['access-control-allow-methods']).toMatch(/DELETE/);
    expect(preflight.headers['access-control-allow-methods']).toMatch(/PATCH/);
  });
});
