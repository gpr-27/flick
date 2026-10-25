import { ENDPOINTS, PrivacySettings, UsernameInput } from '@chat/contracts';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { ApiError, handle, parse } from '../errors.js';
import { toMe, toSummary } from '../domain/present.js';
import { createPresence } from '../../gateway/presence.js';
import { revokeDevices } from '../../devices/revoke.js';
import { findProfile, getSettings, updateSettings } from '../repo/privacy.js';
import {
  anonymiseUser,
  exportChunks,
  getStats,
  hideFlickChat,
  isUniqueViolation,
  usernameTaken,
} from '../repo/account.js';
import { blockUser, createReport, listBlocks, unblockUser, userExists } from '../repo/blocks.js';
import {
  claimAvatarAttachment,
  findUserById,
  listDirectory,
  searchUsers,
  updateProfile,
  type ProfileChanges,
} from '../repo/users.js';

const { users, moderation } = ENDPOINTS;

// The directory cursor carries the sort key of the last row: the name, then the username.
// Base64url, so it is safe in a query string; a bad value is a 400, never a server error.
const encodeDirectoryCursor = (key: { name: string; username: string }): string =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

function parseDirectoryCursor(cursor: string): { name: string; username: string } {
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (
      typeof key === 'object' &&
      key !== null &&
      typeof (key as { name?: unknown }).name === 'string' &&
      typeof (key as { username?: unknown }).username === 'string'
    ) {
      return key as { name: string; username: string };
    }
  } catch {
    // fall through to the error below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
}

/** What `viewerId` may see of a profile row. You always see yourself in full. */
async function presentProfile(
  deps: AppDeps,
  presence: ReturnType<typeof createPresence>,
  viewerId: string,
  row: NonNullable<Awaited<ReturnType<typeof findProfile>>>,
) {
  const shows = (level: string | null) =>
    row.id === viewerId || (level ?? 'everyone') === 'everyone';
  // Redis is only a cache: if it is down, show the user as offline instead of failing.
  const online = await presence.isOnline(row.id).catch(() => false);
  const summary = toSummary(deps.config, row);
  return {
    ...summary,
    avatar_url: shows(row.photo_privacy) ? summary.avatar_url : null,
    about: shows(row.about_privacy) ? row.about : null,
    last_seen_at:
      !online && shows(row.last_seen_privacy) ? (row.last_seen_at?.toISOString() ?? null) : null,
    online,
    blocked_by_me: row.blocked_by_me,
  };
}

export function userRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config, db } = deps;
  const guard = { preHandler: app.authenticate };
  const presence = createPresence(deps.redis);

  app.get(
    users.me.path,
    guard,
    handle(async (req) => {
      const me = await findUserById(db, req.auth!.userId);
      if (!me) throw new ApiError('NOT_FOUND', 'User not found');
      return toMe(config, me);
    }),
  );

  app.patch(
    users.updateMe.path,
    guard,
    handle(async (req) => {
      const { userId } = req.auth!;
      const body = parse(users.updateMe.body, req.body);
      const changes: ProfileChanges = {};
      if (body.display_name !== undefined) changes.display_name = body.display_name;
      if (body.username !== undefined) changes.username = body.username.toLowerCase();
      // The contract limits `about` to LIMITS.MAX_ABOUT_LENGTH characters (the column's limit).
      // An empty line clears it.
      if (body.about !== undefined) changes.about = body.about === '' ? null : body.about;
      if (body.avatar_attachment_id !== undefined) {
        if (body.avatar_attachment_id === null) changes.avatar_object_key = null;
        else {
          const attachment = await claimAvatarAttachment(db, userId, body.avatar_attachment_id);
          if (!attachment) throw new ApiError('NOT_FOUND', 'Uploaded avatar not found');
          changes.avatar_object_key = attachment.object_key;
        }
      }
      if (Object.keys(changes).length === 0) {
        const current = await findUserById(db, userId);
        if (!current) throw new ApiError('NOT_FOUND', 'User not found');
        return toMe(config, current);
      }
      try {
        return toMe(config, await updateProfile(db, userId, changes));
      } catch (error) {
        // The unique index on usernames is the real check; the availability call is only a hint.
        if (isUniqueViolation(error)) throw new ApiError('CONFLICT', 'That username is taken');
        throw error;
      }
    }),
  );

  app.get(
    users.usernameAvailable.path,
    { ...guard, config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    handle(async (req) => {
      const { u } = parse(users.usernameAvailable.query, req.query);
      if (!UsernameInput.safeParse(u).success) return { available: false, reason: 'invalid' };
      return (await usernameTaken(db, u.toLowerCase(), req.auth!.userId))
        ? { available: false, reason: 'taken' }
        : { available: true };
    }),
  );

  app.get(
    users.stats.path,
    guard,
    handle(async (req) => {
      const stats = await getStats(db, req.auth!.userId);
      if (!stats) throw new ApiError('NOT_FOUND', 'User not found');
      return {
        chats: stats.chats,
        groups: stats.groups,
        days_on_flick: stats.days,
        last_active_at: stats.last_active_at?.toISOString() ?? null,
      };
    }),
  );

  app.get(
    users.settings.path,
    guard,
    handle((req) => getSettings(db, req.auth!.userId)),
  );

  app.patch(
    users.updateSettings.path,
    guard,
    handle((req) =>
      updateSettings(db, req.auth!.userId, parse(users.updateSettings.body, req.body)),
    ),
  );

  // The data download. It streams, so a big history never sits in memory; a stricter limit than
  // the global one because it reads a lot.
  app.get(
    users.export.path,
    { ...guard, config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    handle((req, reply) => {
      const day = new Date().toISOString().slice(0, 10);
      return Promise.resolve(
        reply
          .header('content-type', 'application/json; charset=utf-8')
          .header('content-disposition', `attachment; filename="flick-export-${day}.json"`)
          .header('cache-control', 'no-store')
          .send(Readable.from(exportChunks(db, req.auth!.userId))),
      );
    }),
  );

  app.post(
    users.deleteAccount.path,
    guard,
    handle(async (req, reply) => {
      const { userId } = req.auth!;
      const { username } = parse(users.deleteAccount.body, req.body);
      const me = await findUserById(db, userId);
      if (!me) throw new ApiError('NOT_FOUND', 'User not found');
      if (username.toLowerCase() !== me.username.toLowerCase())
        throw new ApiError('VALIDATION_FAILED', 'Type your username exactly to delete the account');
      await anonymiseUser(db, userId);
      await revokeDevices(app, deps, userId); // every device: 401 from now on, sockets closed
      app.disconnectRooms([`user:${userId}`]);
      return reply.code(204).send();
    }),
  );

  app.delete(
    users.clearFlickChat.path,
    guard,
    handle(async (req, reply) => {
      await hideFlickChat(db, req.auth!.userId);
      return reply.code(204).send();
    }),
  );

  app.get(
    users.directory.path,
    guard,
    handle(async (req) => {
      const { cursor, limit } = parse(users.directory.query, req.query);
      const after = cursor ? parseDirectoryCursor(cursor) : null;
      const rows = await listDirectory(db, req.auth!.userId, after, limit);
      const last = rows.at(-1);
      const next =
        rows.length === limit && last
          ? encodeDirectoryCursor({ name: last.display_name, username: last.username })
          : null;
      return { items: rows.map((row) => toSummary(config, row)), next_cursor: next };
    }),
  );

  app.get(
    users.search.path,
    guard,
    handle(async (req) => {
      const { q, limit } = parse(users.search.query, req.query);
      const rows = await searchUsers(db, req.auth!.userId, q, limit);
      // Search returns the best matches only, so there is no next page.
      return { items: rows.map((row) => toSummary(config, row)), next_cursor: null };
    }),
  );

  // The older privacy-only endpoints answer with just the four privacy fields.
  app.get(
    users.privacy.path,
    guard,
    handle(async (req) => PrivacySettings.parse(await getSettings(db, req.auth!.userId))),
  );

  app.patch(
    users.updatePrivacy.path,
    guard,
    handle(async (req) =>
      PrivacySettings.parse(
        await updateSettings(db, req.auth!.userId, parse(users.updatePrivacy.body, req.body)),
      ),
    ),
  );

  // Registered after the static /users/me and /users/search paths, which win over :user_id.
  app.get(
    users.profile.path,
    guard,
    handle(async (req) => {
      const viewerId = req.auth!.userId;
      const { user_id } = parse(users.profile.params, req.params);
      const row = await findProfile(db, viewerId, { id: user_id });
      if (!row) throw new ApiError('NOT_FOUND', 'User not found');
      return presentProfile(deps, presence, viewerId, row);
    }),
  );

  // The page behind a shared link, /u/<username>. Same privacy rules as the profile above.
  app.get(
    users.byUsername.path,
    guard,
    handle(async (req) => {
      const viewerId = req.auth!.userId;
      const { username } = parse(users.byUsername.params, req.params);
      const row = await findProfile(db, viewerId, { username });
      if (!row) throw new ApiError('NOT_FOUND', 'User not found');
      return presentProfile(deps, presence, viewerId, row);
    }),
  );

  app.post(
    moderation.block.path,
    guard,
    handle(async (req, reply) => {
      const { userId } = req.auth!;
      const { user_id } = parse(moderation.block.body, req.body);
      if (user_id === userId) throw new ApiError('VALIDATION_FAILED', 'You cannot block yourself');
      if (!(await userExists(db, user_id))) throw new ApiError('NOT_FOUND', 'User not found');
      await blockUser(db, userId, user_id);
      return reply.code(204).send();
    }),
  );

  app.delete(
    moderation.unblock.path,
    guard,
    handle(async (req, reply) => {
      const { user_id } = parse(moderation.unblock.params, req.params);
      await unblockUser(db, req.auth!.userId, user_id);
      return reply.code(204).send();
    }),
  );

  app.post(
    moderation.report.path,
    guard,
    handle(async (req) => {
      const { userId } = req.auth!;
      const body = parse(moderation.report.body, req.body);
      const hasMessage = body.conversation_id !== undefined && body.message_id !== undefined;
      if (!body.user_id && !hasMessage) {
        throw new ApiError('VALIDATION_FAILED', 'Say who or which message you are reporting');
      }
      if (body.user_id === userId)
        throw new ApiError('VALIDATION_FAILED', 'You cannot report yourself');
      const created = await createReport(db, userId, {
        userId: body.user_id,
        conversationId: body.conversation_id,
        messageId: body.message_id,
        reason: body.reason,
        details: body.details,
      });
      if (!created) throw new ApiError('NOT_FOUND', 'Message not found');
      if (body.block && created.reportedUserId && created.reportedUserId !== userId) {
        await blockUser(db, userId, created.reportedUserId);
      }
      return { report_id: created.reportId };
    }),
  );

  app.get(
    moderation.blocks.path,
    guard,
    handle(async (req) => {
      const { cursor, limit } = parse(moderation.blocks.query, req.query);
      const rows = await listBlocks(db, req.auth!.userId, limit, decodeCursor(cursor));
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          user: toSummary(config, row),
          blocked_at: row.blocked_at.toISOString(),
        })),
        next_cursor:
          rows.length > limit && last ? encodeCursor(last.blocked_at_text, last.id) : null,
      };
    }),
  );
}

const encodeCursor = (blockedAt: string, blockedId: string) =>
  Buffer.from(JSON.stringify([blockedAt, blockedId])).toString('base64url');

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const [blockedAt, blockedId] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [
      string,
      string,
    ];
    if (typeof blockedAt === 'string' && typeof blockedId === 'string')
      return { blockedAt, blockedId };
  } catch {
    // fall through to the error below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
}
