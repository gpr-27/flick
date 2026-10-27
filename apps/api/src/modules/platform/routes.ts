import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENDPOINTS, HookPostBody } from '@chat/contracts';
import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage } from '@chat/db';
import { sql } from 'kysely';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db.js';
import { ApiError, handle, parse } from '../users/errors.js';
import { emailAliasFor } from './emailAlias.js';

const { platform } = ENDPOINTS;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function requireMember(db: Db, conversationId: string, userId: string): Promise<void> {
  const row = await db
    .selectFrom('conversation_members')
    .select('user_id')
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new ApiError('NOT_FOUND', 'Conversation not found');
}

/** Posts as the Flick bot user; the webhook or email name is the first line so it reads as labelled. */
async function postAsBot(db: Db, conversationId: string, text: string): Promise<void> {
  await allocateSeqAndInsertMessage(db, {
    conversationId,
    senderId: FLICK_BOT_USER_ID,
    senderDeviceId: null,
    clientMessageId: null,
    type: 'text',
    bodyText: text,
    content: null,
    authorize: false, // the bot is not a member of the chats it posts in
  });
}

/**
 * Platform features: incoming webhooks, email-to-chat, storage usage, weekly stats and the
 * "new device" alert switch.
 */
export function platformRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const guard = { preHandler: app.authenticate };

  // ---- incoming webhooks (managed by chat members) ----
  app.get(
    platform.webhooks.path,
    guard,
    handle(async (req) => {
      const { conversation_id } = parse(platform.webhooks.params, req.params);
      await requireMember(db, conversation_id, req.auth!.userId);
      const rows = await db
        .selectFrom('chat_webhooks')
        .select(['id', 'name', 'created_at'])
        .where('conversation_id', '=', conversation_id)
        .orderBy('created_at')
        .execute();
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          created_at: r.created_at.toISOString(),
        })),
      };
    }),
  );

  app.post(
    platform.createWebhook.path,
    guard,
    handle(async (req, reply) => {
      const { conversation_id } = parse(platform.createWebhook.params, req.params);
      const { name } = parse(platform.createWebhook.body, req.body);
      const { userId } = req.auth!;
      await requireMember(db, conversation_id, userId);
      const token = randomBytes(24).toString('base64url');
      const row = await db
        .insertInto('chat_webhooks')
        .values({ conversation_id, created_by: userId, token_hash: hashToken(token), name })
        .returning(['id', 'name', 'created_at'])
        .executeTakeFirstOrThrow();
      return reply
        .code(201)
        .send({ id: row.id, name: row.name, created_at: row.created_at.toISOString(), token });
    }),
  );

  app.delete(
    platform.revokeWebhook.path,
    guard,
    handle(async (req, reply) => {
      const { conversation_id, webhook_id } = parse(platform.revokeWebhook.params, req.params);
      await requireMember(db, conversation_id, req.auth!.userId);
      await db
        .deleteFrom('chat_webhooks')
        .where('id', '=', webhook_id)
        .where('conversation_id', '=', conversation_id)
        .execute();
      return reply.code(204).send();
    }),
  );

  // ---- public: a webhook posts a message (token is the credential; 30 per minute per IP) ----
  app.post(
    '/hooks/:id/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    handle(async (req, reply) => {
      const params = parse(
        z.object({ id: z.uuid(), token: z.string().min(10).max(100) }),
        req.params,
      );
      const { text } = parse(HookPostBody, req.body);
      const hook = await db
        .selectFrom('chat_webhooks')
        .select(['conversation_id', 'name', 'token_hash'])
        .where('id', '=', params.id)
        .executeTakeFirst();
      // Same answer for a wrong id and a wrong token.
      if (!hook || !safeEqual(hook.token_hash, hashToken(params.token)))
        throw new ApiError('NOT_FOUND', 'Webhook not found');
      await postAsBot(db, hook.conversation_id, `[${hook.name}] ${text}`);
      return reply.code(204).send();
    }),
  );

  // ---- public: inbound email provider (Postmark or SendGrid) ----
  app.post(
    '/inbound/email',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    handle(async (req, reply) => {
      const secret = config.INBOUND_EMAIL_SECRET;
      if (!secret) throw new ApiError('NOT_FOUND', 'Not found');
      const sent = req.headers['x-inbound-secret'];
      if (typeof sent !== 'string' || !safeEqual(sent, secret))
        throw new ApiError('UNAUTHORIZED', 'Bad secret');
      // Postmark: To, Subject, TextBody. SendGrid: to, subject, text.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const pick = (...keys: string[]): string => {
        for (const k of keys) if (typeof body[k] === 'string') return body[k];
        return '';
      };
      const to = pick('To', 'to', 'OriginalRecipient');
      const subject = pick('Subject', 'subject').trim();
      const text = pick('TextBody', 'text', 'StrippedTextReply').trim();
      const alias = /([A-Za-z0-9._-]+)@/.exec(to)?.[1]?.toLowerCase();
      if (!alias) throw new ApiError('VALIDATION_FAILED', 'No recipient');
      const user = await db
        .selectFrom('users')
        .select('id')
        .where(sql`lower(username)`, '=', alias)
        .executeTakeFirst();
      const saved = user
        ? await db
            .selectFrom('conversations')
            .select('id')
            .where('saved_for', '=', user.id)
            .executeTakeFirst()
        : undefined;
      // Unknown alias: answer 200 so the provider does not retry forever.
      if (saved) {
        const message = `${subject ? `Email: ${subject}` : 'Email'}\n\n${text}`.slice(0, 60000);
        await postAsBot(db, saved.id, message);
      }
      return reply.code(200).send({ ok: true });
    }),
  );

  // ---- the user's forwarding address for email-to-chat (null when it is not configured) ----
  app.get(
    platform.emailAlias.path,
    guard,
    handle(async (req) => {
      const user = await db
        .selectFrom('users')
        .select('username')
        .where('id', '=', req.auth!.userId)
        .executeTakeFirst();
      return {
        address: emailAliasFor(
          user?.username,
          config.INBOUND_EMAIL_SECRET,
          config.INBOUND_EMAIL_DOMAIN,
        ),
      };
    }),
  );

  // ---- storage usage per chat ----
  app.get(
    platform.mediaUsage.path,
    guard,
    handle(async (req) => {
      const { userId } = req.auth!;
      const result = await sql<{
        conversation_id: string;
        name: string | null;
        peer: string | null;
        saved_for: string | null;
        files: number;
        bytes: string;
      }>`
        SELECT c.id AS conversation_id, c.name, c.saved_for,
               (SELECT u.display_name FROM conversation_members pm JOIN users u ON u.id = pm.user_id
                 WHERE pm.conversation_id = c.id AND pm.user_id <> ${userId} LIMIT 1) AS peer,
               count(*)::int AS files, COALESCE(sum(a.size_bytes), 0)::text AS bytes
        FROM messages m
        JOIN attachments a ON a.id = m.attachment_id
        JOIN conversations c ON c.id = m.conversation_id
        JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = ${userId} AND me.left_at IS NULL
        WHERE m.deleted_at IS NULL
        GROUP BY c.id, c.name, c.saved_for
        ORDER BY sum(a.size_bytes) DESC
        LIMIT 100
      `.execute(db);
      const items = result.rows.map((r) => ({
        conversation_id: r.conversation_id,
        name: r.saved_for ? 'Saved messages' : (r.name ?? r.peer ?? 'Chat'),
        files: r.files,
        bytes: Number(r.bytes),
      }));
      return { total_bytes: items.reduce((n, i) => n + i.bytes, 0), items };
    }),
  );

  // ---- your week in Flick ----
  app.get(
    platform.weekStats.path,
    guard,
    handle(async (req) => {
      const { userId } = req.auth!;
      const mine = await sql<{
        conversation_id: string;
        name: string | null;
        peer: string | null;
        saved_for: string | null;
        n: number;
        voice_ms: string;
      }>`
        SELECT c.id AS conversation_id, c.name, c.saved_for,
               (SELECT u.display_name FROM conversation_members pm JOIN users u ON u.id = pm.user_id
                 WHERE pm.conversation_id = c.id AND pm.user_id <> ${userId} LIMIT 1) AS peer,
               count(*)::int AS n,
               COALESCE(sum(CASE WHEN m.type = 'voice' THEN (m.content->>'duration_ms')::bigint END), 0)::text AS voice_ms
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.sender_id = ${userId} AND m.deleted_at IS NULL
          AND m.created_at > now() - interval '7 days'
        GROUP BY c.id, c.name, c.saved_for
        ORDER BY n DESC
      `.execute(db);
      const rows = mine.rows;
      return {
        messages_sent: rows.reduce((n, r) => n + r.n, 0),
        voice_minutes: Math.round(rows.reduce((n, r) => n + Number(r.voice_ms), 0) / 6000) / 10,
        busiest_chats: rows.slice(0, 3).map((r) => ({
          conversation_id: r.conversation_id,
          name: r.saved_for ? 'Saved messages' : (r.name ?? r.peer ?? 'Chat'),
          messages: r.n,
        })),
      };
    }),
  );

  // ---- login alert switch ----
  app.get(
    platform.loginAlerts.path,
    guard,
    handle(async (req) => {
      const row = await db
        .selectFrom('user_settings')
        .select('login_alerts')
        .where('user_id', '=', req.auth!.userId)
        .executeTakeFirst();
      return { enabled: row?.login_alerts ?? true };
    }),
  );

  app.put(
    platform.setLoginAlerts.path,
    guard,
    handle(async (req) => {
      const { enabled } = parse(platform.setLoginAlerts.body, req.body);
      await db
        .updateTable('user_settings')
        .set({ login_alerts: enabled })
        .where('user_id', '=', req.auth!.userId)
        .execute();
      return { enabled };
    }),
  );
}
