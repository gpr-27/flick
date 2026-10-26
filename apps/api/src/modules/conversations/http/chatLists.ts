import { ENDPOINTS } from '@chat/contracts';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { ApiError, handle, parse } from '../../users/errors.js';

const { chatLists } = ENDPOINTS;
const MAX_LISTS = 30;

interface Row {
  id: string;
  kind: 'folder' | 'tag';
  name: string;
  color: string | null;
  conversation_ids: string[];
}
const toList = ({ id, kind, name, color, conversation_ids }: Row) => ({
  id,
  kind,
  name,
  color,
  conversation_ids,
});

/** The caller's own folders and tags. Chats that are not the caller's are dropped on save. */
export function chatListRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.get(
    chatLists.list.path,
    guard,
    handle(async (req) => {
      const { rows } = await sql<Row>`
        SELECT id, kind, name, color, conversation_ids FROM chat_lists
        WHERE user_id = ${req.auth!.userId} ORDER BY created_at, id`.execute(db);
      return { items: rows.map(toList) };
    }),
  );

  app.post(
    chatLists.create.path,
    guard,
    handle(async (req, reply) => {
      const body = parse(chatLists.create.body, req.body);
      const userId = req.auth!.userId;
      const count = await sql<{ n: string }>`
        SELECT count(*) AS n FROM chat_lists WHERE user_id = ${userId}`.execute(db);
      if (Number(count.rows[0]?.n) >= MAX_LISTS) throw new ApiError('CONFLICT', 'Too many lists');
      const { rows } = await sql<Row>`
        INSERT INTO chat_lists (user_id, kind, name, color)
        VALUES (${userId}, ${body.kind}, ${body.name}, ${body.color ?? null})
        RETURNING id, kind, name, color, conversation_ids`.execute(db);
      return reply.code(201).send(toList(rows[0]!));
    }),
  );

  app.patch(
    chatLists.update.path,
    guard,
    handle(async (req) => {
      const { list_id } = parse(chatLists.update.params, req.params);
      const body = parse(chatLists.update.body, req.body);
      const userId = req.auth!.userId;
      // Keep only chats the caller is in.
      const ids = body.conversation_ids
        ? (
            await sql<{ conversation_id: string }>`
              SELECT conversation_id FROM conversation_members
              WHERE user_id = ${userId} AND left_at IS NULL
                AND conversation_id = ANY(${body.conversation_ids}::uuid[])`.execute(db)
          ).rows.map((r) => r.conversation_id)
        : null;
      const { rows } = await sql<Row>`
        UPDATE chat_lists SET
          name = COALESCE(${body.name ?? null}, name),
          color = COALESCE(${body.color ?? null}, color),
          conversation_ids = COALESCE(${ids}::uuid[], conversation_ids)
        WHERE id = ${list_id} AND user_id = ${userId}
        RETURNING id, kind, name, color, conversation_ids`.execute(db);
      if (!rows[0]) throw new ApiError('NOT_FOUND', 'List not found');
      return toList(rows[0]);
    }),
  );

  app.delete(
    chatLists.remove.path,
    guard,
    handle(async (req, reply) => {
      const { list_id } = parse(chatLists.remove.params, req.params);
      await sql`DELETE FROM chat_lists WHERE id = ${list_id} AND user_id = ${req.auth!.userId}`.execute(
        db,
      );
      return reply.code(204).send();
    }),
  );
}
