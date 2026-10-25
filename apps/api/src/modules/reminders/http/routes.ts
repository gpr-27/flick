import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { handle, parse } from '../../users/errors.js';
import { cancelReminder, createReminder, listReminders } from '../repo/reminders.js';

const { reminders } = ENDPOINTS;

/**
 * "Remind me". These routes only store and list reminders; the worker delivers them when they
 * are due (see the worker's send-reminders job), reading the message then.
 */
export function reminderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.post(
    reminders.create.path,
    guard,
    handle(async (req, reply) => {
      const body = parse(reminders.create.body, req.body);
      const created = await createReminder(db, req.auth!.userId, {
        messageId: body.message_id,
        conversationId: body.conversation_id,
        remindAt: new Date(body.remind_at),
        note: body.note,
      });
      return reply.code(201).send(created);
    }),
  );

  app.get(
    reminders.list.path,
    guard,
    handle(async (req) => {
      const query = parse(reminders.list.query, req.query);
      return listReminders(db, req.auth!.userId, query);
    }),
  );

  app.delete(
    reminders.cancel.path,
    guard,
    handle(async (req, reply) => {
      const { reminder_id } = parse(reminders.cancel.params, req.params);
      await cancelReminder(db, req.auth!.userId, reminder_id);
      return reply.code(204).send();
    }),
  );
}
