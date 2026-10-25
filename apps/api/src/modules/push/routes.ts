import { ENDPOINTS, type PushStatus, type PushTestResult } from '@chat/contracts';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app.js';
import { createPushSender, endpointHash, pushServiceHost } from './sender.js';
import { createRateWindow } from './rate-window.js';

const E = ENDPOINTS.push;

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function tooMany(): Error {
  return Object.assign(new Error('Too many test notifications. Try again in a minute.'), {
    statusCode: 429,
  });
}

// The worker sends the message pushes; the API stores which browsers want them, says what it
// knows about the caller's devices, and can push a test notification to the caller only.
export function pushRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;
  const sender = deps.pushSender ?? createPushSender(config);
  // 3 test pushes a minute per person (in memory: one API process serves the free plan).
  const testWindow = createRateWindow(3, 60_000);

  // null tells the web app that push is off on this server.
  app.get(E.vapidKey.path, { preHandler: app.authenticate }, () => ({
    public_key: config.VAPID_PUBLIC_KEY ?? null,
  }));

  app.post(E.subscribe.path, { preHandler: app.authenticate }, async (req, reply) => {
    const body = E.subscribe.body.safeParse(req.body);
    if (!body.success) throw badRequest(body.error.issues[0]?.message ?? 'Invalid request');
    const { endpoint, keys, prefs } = body.data;
    const { userId, deviceId } = req.auth!;
    // The device row, if this login has one (it ties the subscription to "this device").
    const device = sql<
      string | null
    >`(SELECT id FROM devices WHERE id = ${deviceId}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL)`;
    const prefsJson = JSON.stringify(prefs ?? {});
    await db.transaction().execute(async (trx) => {
      // Subscribing again (same browser) refreshes the row and turns a disabled one back on.
      await trx
        .insertInto('push_subscriptions')
        .values({
          user_id: userId,
          device_id: device,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          prefs: prefsJson,
        })
        .onConflict((oc) =>
          oc.column('endpoint').doUpdateSet({
            user_id: userId,
            device_id: device,
            p256dh: keys.p256dh,
            auth: keys.auth,
            disabled_at: null,
            // Only a request that says its choices replaces the stored ones.
            ...(prefs ? { prefs: prefsJson } : {}),
          }),
        )
        .execute();
      // One row per device: the browser may have a new endpoint after it renewed its subscription.
      await trx
        .deleteFrom('push_subscriptions')
        .where('user_id', '=', userId)
        .where('endpoint', '<>', endpoint)
        .where(sql<boolean>`device_id IS NOT NULL AND device_id = ${device}`)
        .execute();
    });
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

  // What the server has for this device and how many other devices will be told. No secrets.
  app.get(E.status.path, { preHandler: app.authenticate }, async (req): Promise<PushStatus> => {
    const { userId, deviceId } = req.auth!;
    const rows = await db
      .selectFrom('push_subscriptions as s')
      .leftJoin('devices as d', 'd.id', 's.device_id')
      .select(['s.endpoint', 's.device_id', 's.last_status'])
      .where('s.user_id', '=', userId)
      .where('s.disabled_at', 'is', null)
      .where((eb) => eb.or([eb('s.device_id', 'is', null), eb('d.revoked_at', 'is', null)]))
      .orderBy('s.created_at', 'desc')
      .execute();
    const mine = rows.find((r) => r.device_id === deviceId);
    return {
      server_ready: Boolean(config.VAPID_PUBLIC_KEY),
      this_device: {
        subscribed: mine !== undefined,
        endpoint_hash: mine ? endpointHash(mine.endpoint) : null,
        last_status: mine?.last_status ?? null,
      },
      other_devices: rows.filter((r) => r.device_id !== deviceId).length,
    };
  });

  // "Send me a test notification": pushes to the CALLER'S devices only and reports what each
  // push service answered, so a person can see whether push works end to end.
  app.post(E.test.path, { preHandler: app.authenticate }, async (req): Promise<PushTestResult> => {
    const { userId, deviceId } = req.auth!;
    if (!testWindow.take(userId)) throw tooMany();
    if (!sender) return { devices: [], reason: 'not_configured' };

    const subs = await db
      .selectFrom('push_subscriptions as s')
      .leftJoin('devices as d', 'd.id', 's.device_id')
      .select(['s.id', 's.endpoint', 's.p256dh', 's.auth', 's.device_id'])
      .where('s.user_id', '=', userId)
      .where('s.disabled_at', 'is', null)
      .where((eb) => eb.or([eb('s.device_id', 'is', null), eb('d.revoked_at', 'is', null)]))
      .execute();
    if (subs.length === 0) return { devices: [], reason: 'no_subscription' };

    const payload = JSON.stringify({
      type: 'test',
      title: 'Flick test notification',
      body: 'It works! New messages will show up like this.',
    });
    const devices: PushTestResult['devices'] = [];
    for (const sub of subs) {
      const service = pushServiceHost(sub.endpoint);
      let status: number;
      try {
        const res = await sender(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { ttlSeconds: 300, urgency: 'high' },
        );
        status = res.statusCode;
      } catch (error) {
        status = (error as { statusCode?: number }).statusCode ?? 0;
      }
      const ok = status >= 200 && status < 300;
      const gone = status === 404 || status === 410;
      await db
        .updateTable('push_subscriptions')
        .set({
          last_attempt_at: new Date(),
          last_status: status,
          ...(ok ? { last_success_at: new Date() } : {}),
          ...(gone ? { disabled_at: new Date() } : {}),
        })
        .where('id', '=', sub.id)
        .execute();
      req.log.info({ service, status, userId }, 'test push');
      devices.push({
        result: ok ? 'sent' : gone ? 'expired' : 'failed',
        status,
        service,
        this_device: sub.device_id === deviceId,
      });
    }
    return { devices, reason: 'sent' };
  });
}
