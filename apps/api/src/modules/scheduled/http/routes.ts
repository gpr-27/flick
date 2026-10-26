import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { handle, parse } from '../../users/errors.js';
import {
  cancelScheduled,
  createScheduled,
  listScheduled,
  updateScheduled,
} from '../repo/scheduled.js';

const { scheduled } = ENDPOINTS;

/**
 * Scheduling only stores the message. The worker sends it when it is due (see the worker's
 * send-scheduled job), re-checking then that the sender is still a member.
 */
export function scheduledRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.post(
    scheduled.create.path,
    guard,
    handle(async (req, reply) => {
      const { conversation_id } = parse(scheduled.create.params, req.params);
      const body = parse(scheduled.create.body, req.body);
      const created = await createScheduled(db, req.auth!.userId, conversation_id, {
        text: body.text,
        sendAt: new Date(body.send_at),
      });
      return reply.code(201).send(created);
    }),
  );

  app.get(
    scheduled.list.path,
    guard,
    handle(async (req) => ({ items: await listScheduled(db, req.auth!.userId) })),
  );

  app.patch(
    scheduled.update.path,
    guard,
    handle(async (req) => {
      const { scheduled_id } = parse(scheduled.update.params, req.params);
      const body = parse(scheduled.update.body, req.body);
      return updateScheduled(db, req.auth!.userId, scheduled_id, {
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.send_at !== undefined ? { sendAt: new Date(body.send_at) } : {}),
      });
    }),
  );

  app.delete(
    scheduled.cancel.path,
    guard,
    handle(async (req, reply) => {
      const { scheduled_id } = parse(scheduled.cancel.params, req.params);
      await cancelScheduled(db, req.auth!.userId, scheduled_id);
      return reply.code(204).send();
    }),
  );
}
