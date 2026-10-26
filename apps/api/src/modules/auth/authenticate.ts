import { ERROR_CODES, makeError, type ErrorCode } from '@chat/contracts';
import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, Authenticate } from '../../auth-guard.js';
import type { Db } from '../../db.js';
import type { Redis } from '../../redis.js';
import { ensureFlickWelcome } from '../ai/welcome.js';
import { alertNewDevice } from '../platform/loginAlert.js';
import { deviceName } from '../devices/domain/name.js';
import type { Clerk, ClerkProfile } from './clerk.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How long we trust a past check. A disabled user can keep using an open session this long.
const CACHE_SECONDS = 300;

/** The Redis key of a remembered check. Revoking a device or deleting an account removes it. */
export const authCacheKey = (clerkId: string, deviceId: string) => `auth:${clerkId}:${deviceId}`;

class AuthError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Auth {
  authenticate: Authenticate;
  /** For the Socket.IO handshake: the same checks, but null instead of an error. */
  authenticateSocket: (token: string, deviceId: string) => Promise<AuthContext | null>;
}

export function createAuth(deps: { db: Db; redis: Redis; clerk: Clerk }): Auth {
  const { db, redis, clerk } = deps;

  async function check(
    token: string | undefined,
    deviceId: string | undefined,
    userAgent?: string,
  ) {
    if (!token) throw new AuthError('UNAUTHORIZED', 'Missing bearer token');
    if (!deviceId || !UUID.test(deviceId))
      throw new AuthError('VALIDATION_FAILED', 'X-Device-Id must be a UUID made by the client');
    let clerkId: string;
    try {
      clerkId = await clerk.verify(token);
    } catch {
      throw new AuthError('UNAUTHORIZED', 'Invalid or expired token');
    }
    const cacheKey = authCacheKey(clerkId, deviceId);
    const cached = await redis.get(cacheKey).catch(() => null); // Redis is only a cache
    if (cached) return { userId: cached, deviceId };

    const userId = await findOrCreateUser(clerkId);
    await upsertDevice(userId, deviceId, userAgent);
    await redis.set(cacheKey, userId, 'EX', CACHE_SECONDS).catch(() => undefined);
    return { userId, deviceId };
  }

  async function findOrCreateUser(clerkId: string): Promise<string> {
    const existing = await db
      .selectFrom('users')
      .select(['id', 'status', 'created_at'])
      .where('clerk_id', '=', clerkId)
      .executeTakeFirst();
    if (existing) {
      if (existing.status !== 'active') throw new AuthError('FORBIDDEN', 'Account is not active');
      // A Flick chat that is still empty gets its welcome once (accounts older than the welcome).
      // An account made minutes ago whose welcome failed is still treated as new.
      await welcome(existing.id, Date.now() - existing.created_at.getTime() < 10 * 60_000);
      return existing.id;
    }
    return createUser(clerkId, await clerk.profile(clerkId));
  }

  /** Signing in never fails because the welcome could not be written; the next sign-in retries. */
  async function welcome(userId: string, create: boolean): Promise<void> {
    try {
      await ensureFlickWelcome(db, userId, { create });
    } catch {
      // ignored on purpose: see above
    }
  }

  async function createUser(clerkId: string, profile: ClerkProfile): Promise<string> {
    let email = profile.email;
    const base = (profile.username ?? email?.split('@')[0] ?? 'user').replace(
      /[^A-Za-z0-9_.]/g,
      '',
    );
    // Local usernames are unique and 3-32 characters; on a clash a random suffix settles it.
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = attempt === 0 && base.length >= 3 ? '' : `_${randomBytes(3).toString('hex')}`;
      const username = `${base.slice(0, 24)}${suffix}`;
      const row = await db
        .insertInto('users')
        .values({
          clerk_id: clerkId,
          username,
          email,
          display_name: (profile.displayName || username).slice(0, 64),
          avatar_url: profile.imageUrl,
        })
        .onConflict((oc) => oc.doNothing()) // clerk_id, username or email already taken
        .returning('id')
        .executeTakeFirst();
      if (row) {
        await db.insertInto('user_settings').values({ user_id: row.id }).execute();
        await welcome(row.id, true);
        return row.id;
      }
      // Two first requests can race: if the other one won, use its row.
      const raced = await db
        .selectFrom('users')
        .select('id')
        .where('clerk_id', '=', clerkId)
        .executeTakeFirst();
      if (raced) return raced.id;
      email = null; // an email clash must not block sign-in
    }
    throw new AuthError('INTERNAL', 'Could not create the user');
  }

  /**
   * A device is created on first sight. A device id that belongs to another user is refused (403).
   * One this user signed out ("revoked") gets 401, and stays signed out.
   */
  async function upsertDevice(
    userId: string,
    deviceId: string,
    userAgent: string | undefined,
  ): Promise<void> {
    const known = await db
      .selectFrom('devices')
      .select('id')
      .where('id', '=', deviceId)
      .executeTakeFirst();
    const row = await db
      .insertInto('devices')
      .values({ id: deviceId, user_id: userId, name: deviceName(userAgent) })
      .onConflict((oc) =>
        oc
          .column('id')
          // The name comes from the browser each time: a device created before naming existed is
          // fixed the next time it signs in, and a browser update is picked up.
          .doUpdateSet((eb) => ({
            last_active_at: eb.fn('now', []),
            name: deviceName(userAgent),
          }))
          .where('devices.user_id', '=', userId)
          .where('devices.revoked_at', 'is', null),
      )
      .returning('id')
      .executeTakeFirst();
    if (row) {
      if (!known) void alertNewDevice(db, userId, deviceName(userAgent));
      return;
    }
    const existing = await db
      .selectFrom('devices')
      .select('user_id')
      .where('id', '=', deviceId)
      .executeTakeFirst();
    if (existing?.user_id === userId)
      throw new AuthError('UNAUTHORIZED', 'This device was signed out');
    throw new AuthError('FORBIDDEN', 'This device id belongs to another user');
  }

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const deviceId = req.headers['x-device-id'];
    try {
      req.auth = await check(
        token,
        typeof deviceId === 'string' ? deviceId : undefined,
        req.headers['user-agent'],
      );
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      await reply
        .code(ERROR_CODES[error.code].http)
        .send({ error: makeError(error.code, error.message) });
    }
  };

  async function authenticateSocket(token: string, deviceId: string) {
    try {
      return await check(token, deviceId);
    } catch (error) {
      if (error instanceof AuthError) return null;
      throw error;
    }
  }

  return { authenticate, authenticateSocket };
}
