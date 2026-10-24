import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

/** One browser or app install that is signed in to the account. */
export const DeviceItem = z.object({
  id: Id,
  name: z.string(),
  platform: z.enum(['web', 'android', 'ios', 'desktop']),
  created_at: IsoDateTime,
  last_active_at: IsoDateTime,
  /** true for the device that made this request. */
  current: z.boolean(),
});

export const DeviceList = z.object({ items: z.array(DeviceItem) });

export const DeviceParams = z.object({ device_id: Id });
