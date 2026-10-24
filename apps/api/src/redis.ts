import { Redis } from 'ioredis';

export { Redis };

export function createRedis(url: string): Redis {
  // One retry per command, then fail: callers (rate limiter, presence) degrade instead of
  // stalling every request while Redis is down. ioredis keeps reconnecting in the background.
  return new Redis(url, { maxRetriesPerRequest: 1, connectionName: 'chat-api' });
}
