import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import { ApiError, registerErrorHandler } from '../conversations/http/errors.js';
import { clearAlerts, listAlerts, markRead, unreadCount } from './repo.js';

const E = ENDPOINTS.notifications;

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(
      'VALIDATION_FAILED',
      `${issue?.path.join('.') || 'request'}: ${issue?.message}`,
    );
  }
  return result.data;
}

/** The notification centre: the caller's own alerts, newest first. Never anyone else's. */
export function notificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  void app.register((scope) => {
    registerErrorHandler(scope);
    const guard = { preHandler: scope.authenticate };

    scope.get(E.list.path, guard, (req) =>
      listAlerts(db, config, req.auth!.userId, parse(E.list.query, req.query)),
    );

    scope.get(E.unread.path, guard, async (req) => ({
      unread_count: await unreadCount(db, req.auth!.userId),
    }));

    scope.post(E.markRead.path, guard, async (req) => {
      await markRead(db, req.auth!.userId, parse(E.markRead.body, req.body));
      return { unread_count: await unreadCount(db, req.auth!.userId) };
    });

    scope.delete(E.clear.path, guard, async (req, reply) => {
      await clearAlerts(db, req.auth!.userId);
      return reply.code(204).send();
    });
  });
}
