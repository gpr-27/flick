import { z } from 'zod';

/** public_key is null when VAPID keys are not configured; push is then off. */
export const VapidKey = z.object({ public_key: z.string().nullable() });

/** The browser's PushSubscription.toJSON(). */
export const PushSubscribeRequest = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export const PushUnsubscribeRequest = z.object({ endpoint: z.url() });
