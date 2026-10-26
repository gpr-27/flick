import { ENDPOINTS } from '@chat/contracts';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db.js';
import { ApiError, handle, parse } from '../users/errors.js';

const { drafts } = ENDPOINTS;

async function requireMember(db: Db, conversationId: string, userId: string): Promise<void> {
  const member = await db
    .selectFrom('conversation_members')
    .select('user_id')
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  if (!member) throw new ApiError('NOT_FOUND', 'Conversation not found');
}

/** One unsent draft per person per chat (conversation_drafts), so it follows you across devices. */
export function draftRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.get(
    drafts.get.path,
    guard,
    handle(async (req) => {
      const { conversation_id } = parse(drafts.get.params, req.params);
      const userId = req.auth!.userId;
      await requireMember(db, conversation_id, userId);
      const { rows } = await sql<{ body: string; updated_at: Date }>`
        SELECT body, updated_at FROM conversation_drafts
        WHERE user_id = ${userId} AND conversation_id = ${conversation_id}`.execute(db);
      const row = rows[0];
      return { body: row?.body ?? null, updated_at: row ? row.updated_at.toISOString() : null };
    }),
  );

  app.put(
    drafts.put.path,
    guard,
    handle(async (req) => {
      const { conversation_id } = parse(drafts.put.params, req.params);
      const { body } = parse(drafts.put.body, req.body);
      const userId = req.auth!.userId;
      await requireMember(db, conversation_id, userId);
      const { rows } = await sql<{ body: string; updated_at: Date }>`
        INSERT INTO conversation_drafts (user_id, conversation_id, body)
        VALUES (${userId}, ${conversation_id}, ${body})
        ON CONFLICT (user_id, conversation_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
        RETURNING body, updated_at`.execute(db);
      return { body, updated_at: rows[0]!.updated_at.toISOString() };
    }),
  );

  app.delete(
    drafts.delete.path,
    guard,
    handle(async (req, reply) => {
      const { conversation_id } = parse(drafts.delete.params, req.params);
      await sql`DELETE FROM conversation_drafts
        WHERE user_id = ${req.auth!.userId} AND conversation_id = ${conversation_id}`.execute(db);
      return reply.code(204).send();
    }),
  );
}
