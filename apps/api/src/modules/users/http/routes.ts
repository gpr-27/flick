import { ENDPOINTS, Id } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { ApiError, handle, parse } from '../errors.js';
import { toMe, toSummary } from '../domain/present.js';
import { createPresence } from '../../gateway/presence.js';
import { findProfile, getPrivacy, updatePrivacy } from '../repo/privacy.js';
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

// The directory cursor carries the sort key of the last row: the name, then the username, both
// exactly as the database lower-cases them (see listDirectory).
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
      const { name, username } = key as { name: string; username: string };
      // U+0000 cannot go into a Postgres comparison; a cursor with one was not made by us.
      if (!name.includes('\u0000') && !username.includes('\u0000')) return { name, username };
    }
  } catch {
    // fall through to the error below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
}

// The `about` column is limited to 139 characters (the contract allows 280, so check it here
// and answer with a clear 400 instead of a database error).
const ABOUT_MAX = 139;

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
      if (body.about !== undefined) {
        if (body.about !== null && body.about.length > ABOUT_MAX)
          throw new ApiError(
            'VALIDATION_FAILED',
            `about is limited to ${String(ABOUT_MAX)} characters`,
          );
        changes.about = body.about;
      }
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
      return toMe(config, await updateProfile(db, userId, changes));
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
          ? encodeDirectoryCursor({ name: last.name_key, username: last.username_key })
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

  app.get(
    users.privacy.path,
    guard,
    handle((req) => getPrivacy(db, req.auth!.userId)),
  );

  app.patch(
    users.updatePrivacy.path,
    guard,
    handle((req) => updatePrivacy(db, req.auth!.userId, parse(users.updatePrivacy.body, req.body))),
  );

  // Registered after the static /users/me and /users/search paths, which win over :user_id.
  app.get(
    users.profile.path,
    guard,
    handle(async (req) => {
      const viewerId = req.auth!.userId;
      const { user_id } = parse(users.profile.params, req.params);
      const row = await findProfile(db, viewerId, user_id);
      if (!row) throw new ApiError('NOT_FOUND', 'User not found');
      // You always see yourself in full. Anyone else sees only what the user allows.
      const shows = (level: string | null) =>
        user_id === viewerId || (level ?? 'everyone') === 'everyone';
      // Redis is only a cache: if it is down, show the user as offline instead of failing.
      const online = await presence.isOnline(user_id).catch(() => false);
      const summary = toSummary(config, row);
      return {
        ...summary,
        avatar_url: shows(row.photo_privacy) ? summary.avatar_url : null,
        about: shows(row.about_privacy) ? row.about : null,
        last_seen_at:
          !online && shows(row.last_seen_privacy)
            ? (row.last_seen_at?.toISOString() ?? null)
            : null,
        online,
        blocked_by_me: row.blocked_by_me,
      };
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
      if (body.user_id && !(await userExists(db, body.user_id)))
        throw new ApiError('NOT_FOUND', 'User not found');
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
    // Both go into SQL casts (::timestamptz, ::uuid), so a value of the wrong form must be
    // refused here instead of failing in the database.
    if (
      typeof blockedAt === 'string' &&
      typeof blockedId === 'string' &&
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/.test(blockedAt) &&
      Id.safeParse(blockedId).success
    )
      return { blockedAt, blockedId };
  } catch {
    // fall through to the error below
  }
  throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
}
