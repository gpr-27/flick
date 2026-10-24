import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';

const E = ENDPOINTS.push;

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

// The worker sends the pushes; the API only stores which browsers want them.
export function pushRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  // null tells the web app that push is off on this server.
  app.get(E.vapidKey.path, { preHandler: app.authenticate }, () => ({
    public_key: config.VAPID_PUBLIC_KEY ?? null,
  }));

  app.post(E.subscribe.path, { preHandler: app.authenticate }, async (req, reply) => {
    const body = E.subscribe.body.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? 'Invalid request');
    const { endpoint, keys } = body.data;
    // Subscribing again (same browser) refreshes the row and turns a disabled one back on.
    await db
      .insertInto('push_subscriptions')
      .values({ user_id: req.auth!.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          user_id: req.auth!.userId,
          p256dh: keys.p256dh,
          auth: keys.auth,
          disabled_at: null,
        }),
      )
      .execute();
    return reply.code(204).send();
  });

  app.post(E.unsubscribe.path, { preHandler: app.authenticate }, async (req, reply) => {
    const body = E.unsubscribe.body.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? 'Invalid request');
    await db
      .deleteFrom('push_subscriptions')
      .where('endpoint', '=', body.data.endpoint)
      .where('user_id', '=', req.auth!.userId)
      .execute();
    return reply.code(204).send();
  });
}
