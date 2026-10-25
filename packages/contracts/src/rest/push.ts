import { z } from 'zod';

/** public_key is null when VAPID keys are not configured; push is then off. */
export const VapidKey = z.object({ public_key: z.string().nullable() });

/**
 * What this device wants from pushes, so the server can honour it (the server cannot read the
 * browser's settings). `quiet` is a daily window in the device's own clock: minutes after
 * midnight, plus the device's offset from UTC so the server can tell what time it is there.
 */
export const PushPrefs = z.object({
  /** false = show "New message" instead of the text. */
  previews: z.boolean().optional(),
  quiet: z
    .object({
      from_min: z.number().int().min(0).max(1439),
      to_min: z.number().int().min(0).max(1439),
      /** Minutes to add to UTC to get the device's local time (can be negative). */
      offset_min: z.number().int().min(-840).max(840),
    })
    .nullable()
    .optional(),
});
export type PushPrefs = z.infer<typeof PushPrefs>;

/** The browser's PushSubscription.toJSON(), plus this device's notification choices. */
export const PushSubscribeRequest = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  prefs: PushPrefs.optional(),
});

export const PushUnsubscribeRequest = z.object({ endpoint: z.url() });

/**
 * What the server knows about push for the caller. No endpoints or keys: `endpoint_hash` lets the
 * browser check that the server has its CURRENT subscription by hashing its own endpoint.
 */
export const PushStatus = z.object({
  /** false = the server has no VAPID keys, so nothing can be sent. */
  server_ready: z.boolean(),
  this_device: z.object({
    subscribed: z.boolean(),
    /** First 16 hex characters of SHA-256 of the endpoint; null when not subscribed. */
    endpoint_hash: z.string().nullable(),
    /** Last HTTP status the push service gave this device (201 = accepted), null if never tried. */
    last_status: z.number().int().nullable(),
  }),
  /** The caller's other devices that can receive pushes. */
  other_devices: z.number().int().min(0),
});
export type PushStatus = z.infer<typeof PushStatus>;

/** The result of one test push to one of the caller's devices. */
export const PushTestDevice = z.object({
  /** sent = the push service accepted it; expired = the device is gone (removed); failed = other. */
  result: z.enum(['sent', 'expired', 'failed']),
  /** The push service's HTTP status (0 when it never answered). */
  status: z.number().int(),
  /** The push service's host, for example fcm.googleapis.com. Never the full endpoint. */
  service: z.string(),
  this_device: z.boolean(),
});
export const PushTestResult = z.object({
  devices: z.array(PushTestDevice),
  /** Why nothing was sent, when the list is empty. */
  reason: z.enum(['sent', 'no_subscription', 'not_configured']),
});
export type PushTestResult = z.infer<typeof PushTestResult>;
