import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.js';
import type { Redis } from '../../redis.js';
import { authCacheKey } from '../auth/authenticate.js';

/**
 * Signs out some devices of one user and returns their ids.
 *  1. marks them revoked, so the next request with that device id gets 401;
 *  2. forgets the remembered login check in Redis (it would be good for 5 minutes);
 *  3. closes their sockets, on every API replica.
 * `only` limits it to one device, `except` keeps one (usually the caller's own).
 */
export async function revokeDevices(
  app: FastifyInstance,
  deps: { db: Db; redis: Redis },
  userId: string,
  which: { only?: string; except?: string } = {},
): Promise<string[]> {
  let update = deps.db
    .updateTable('devices')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (which.only) update = update.where('id', '=', which.only);
  if (which.except) update = update.where('id', '!=', which.except);
  const ids = (await update.returning('id').execute()).map((d) => d.id);
  if (ids.length === 0) return ids;

  const user = await deps.db
    .selectFrom('users')
    .select('clerk_id')
    .where('id', '=', userId)
    .executeTakeFirst();
  const clerkId = user?.clerk_id;
  if (clerkId) {
    // Redis is only a cache: if it is down there is nothing remembered to forget.
    await Promise.all(ids.map((id) => deps.redis.del(authCacheKey(clerkId, id)).catch(() => 0)));
  }
  app.disconnectRooms(ids.map((id) => `device:${id}`));
  return ids;
}
