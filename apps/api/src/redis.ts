import { Redis } from 'ioredis';

export { Redis };

export function createRedis(url: string): Redis {
  // One retry per command, then fail: callers (rate limiter, presence) degrade instead of
  // stalling every request while Redis is down. ioredis keeps reconnecting in the background.
  //
  // commandTimeout matters when Redis does not answer at all (a network partition rather than a
  // refused connection): without it a command waits for ioredis' 10 s connect timeout, and since
  // the rate limiter runs on every request, every request would take 10 s while Redis is away.
  // With it, a command gives up after 1 s (measured in test/integration/failure-injection.int.test.ts).
  return new Redis(url, {
    maxRetriesPerRequest: 1,
    commandTimeout: 1_000,
    connectionName: 'chat-api',
  });
}
