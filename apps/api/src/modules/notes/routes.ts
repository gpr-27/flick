import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { AppDeps } from '../../app.js';
import { handle, parse } from '../users/errors.js';
import { loadMessage, requireMember } from '../messages/repo/access.js';

const { notes } = ENDPOINTS;

/** Private per-user notes on messages, and the edit history of a message. */
export function noteRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.get(
    notes.list.path,
    guard,
    handle(async (req) => {
      const { conversation_id } = parse(notes.list.params, req.params);
      const userId = req.auth!.userId;
      await requireMember(db, conversation_id, userId);
      const rows = await db
        .selectFrom('message_notes as n')
        .innerJoin('messages as m', 'm.id', 'n.message_id')
        .select(['n.message_id', 'n.body'])
        .where('n.user_id', '=', userId)
        .where('m.conversation_id', '=', conversation_id)
        .execute();
      return { notes: rows };
    }),
  );

  app.put(
    notes.put.path,
    guard,
    handle(async (req) => {
      const params = parse(notes.put.params, req.params);
      const { body } = parse(notes.put.body, req.body);
      const userId = req.auth!.userId;
      await requireMember(db, params.conversation_id, userId);
      await loadMessage(db, params.conversation_id, params.message_id);
      await db
        .insertInto('message_notes')
        .values({ user_id: userId, message_id: params.message_id, body })
        .onConflict((oc) =>
          oc.columns(['user_id', 'message_id']).doUpdateSet({ body, updated_at: sql<Date>`now()` }),
        )
        .execute();
      return { message_id: params.message_id, body };
    }),
  );

  app.delete(
    notes.delete.path,
    guard,
    handle(async (req, reply) => {
      const params = parse(notes.delete.params, req.params);
      await db
        .deleteFrom('message_notes')
        .where('user_id', '=', req.auth!.userId)
        .where('message_id', '=', params.message_id)
        .execute();
      return reply.code(204).send();
    }),
  );

  app.get(
    notes.editHistory.path,
    guard,
    handle(async (req) => {
      const params = parse(notes.editHistory.params, req.params);
      await requireMember(db, params.conversation_id, req.auth!.userId);
      await loadMessage(db, params.conversation_id, params.message_id);
      const rows = await db
        .selectFrom('message_edits')
        .select(['body_text', 'edited_at'])
        .where('message_id', '=', params.message_id)
        .orderBy('edited_at')
        .execute();
      return { edits: rows.map((r) => ({ ...r, edited_at: r.edited_at.toISOString() })) };
    }),
  );
}
