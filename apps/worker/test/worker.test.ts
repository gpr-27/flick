import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createOpsServer } from '../src/server.js';

const required = {
  DATABASE_URL: 'postgres://chat:chat@localhost:5432/chat',
  REDIS_URL: 'redis://localhost:6379',
};

describe('worker config', () => {
  it('requires only Postgres and Redis, and says so', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL \(PostgreSQL.*\n.*REDIS_URL \(Redis/);
    const config = loadConfig(required);
    expect(config.WORKER_METRICS_PORT).toBe(9465);
    expect(config.VAPID_PUBLIC_KEY).toBeUndefined(); // no keys: simulated notifications
  });

  it('wants all three VAPID values or none', () => {
    expect(() => loadConfig({ ...required, VAPID_PUBLIC_KEY: 'pub' })).toThrow(
      /VAPID_PRIVATE_KEY.*\n.*VAPID_SUBJECT/,
    );
  });
});

describe('ops server', () => {
  it('serves metrics and reports readiness from the checks', async () => {
    let healthy = true;
    const check = {
      name: 'redis',
      critical: true,
      check: () => (healthy ? Promise.resolve() : Promise.reject(new Error('down'))),
    };
    const server = createOpsServer([check], () => false).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${url}/metrics`)).text()).toContain(
        'eventloop_lag_seconds{service="worker"}',
      );
      expect((await fetch(`${url}/health/live`)).status).toBe(200);
      expect((await fetch(`${url}/health/ready`)).status).toBe(200);
      healthy = false;
      const res = await fetch(`${url}/health/ready`);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        status: 'not_ready',
        checks: [{ name: 'redis', ok: false, error: 'down' }],
      });
    } finally {
      server.close();
    }
  });
});
