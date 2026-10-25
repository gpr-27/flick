import { createServer } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedis } from '../../src/redis.js';
import { closeIo, createIo } from '../../src/ws.js';

// Redis being lost must not end the process. The Socket.IO Redis adapter publishes on every emit
// without awaiting or catching the result; a failed publish used to be an unhandled promise
// rejection, which Node turns into a crash (ADR-0005). Here the connection is cut for good after
// the adapter was built against a live Redis, the way an outage looks to a running server.
// (The same thing with a real Redis container being stopped and started is in failure-injection.)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Socket.IO emits after Redis is lost', () => {
  const opened: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const close of opened) await close();
  });

  it('do not produce an unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const redis = createRedis(process.env.REDIS_URL ?? '');
    redis.on('error', () => undefined);
    const http = createServer();
    const io = createIo(http, redis, []);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    opened.push(async () => {
      await closeIo(io).catch(() => undefined);
      http.close();
    });
    try {
      redis.disconnect(); // from now on every command fails with "Connection is closed"
      for (let i = 0; i < 5; i++) io.to('user:someone').emit('new_message', { n: i });
      await sleep(500);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
