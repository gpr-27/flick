import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { ApiError, handle, parse } from '../../users/errors.js';
import { revokeDevices } from '../revoke.js';

const { devices } = ENDPOINTS;

/** The devices (browsers) signed in to the caller's account. A user only ever sees their own. */
export function deviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const guard = { preHandler: app.authenticate };

  app.get(
    devices.list.path,
    guard,
    handle(async (req) => {
      const { userId, deviceId } = req.auth!;
      const rows = await db
        .selectFrom('devices')
        .select(['id', 'name', 'platform', 'created_at', 'last_active_at'])
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .orderBy('last_active_at', 'desc')
        .execute();
      return {
        items: rows.map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          created_at: d.created_at.toISOString(),
          last_active_at: d.last_active_at.toISOString(),
          current: d.id === deviceId,
        })),
      };
    }),
  );

  // "Sign out of other devices". Registered before /devices/:device_id; the static path wins anyway.
  app.post(
    devices.revokeOthers.path,
    guard,
    handle(async (req, reply) => {
      const { userId, deviceId } = req.auth!;
      await revokeDevices(app, deps, userId, { except: deviceId });
      return reply.code(204).send();
    }),
  );

  app.delete(
    devices.revoke.path,
    guard,
    handle(async (req, reply) => {
      const { userId, deviceId } = req.auth!;
      const { device_id } = parse(devices.revoke.params, req.params);
      if (device_id === deviceId)
        throw new ApiError(
          'VALIDATION_FAILED',
          'This is the device you are using. Sign out instead.',
        );
      // The user_id condition is the ownership check: another user's device looks like a missing one.
      const mine = await db
        .selectFrom('devices')
        .select('id')
        .where('id', '=', device_id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!mine) throw new ApiError('NOT_FOUND', 'Device not found');
      await revokeDevices(app, deps, userId, { only: device_id });
      return reply.code(204).send();
    }),
  );
}
