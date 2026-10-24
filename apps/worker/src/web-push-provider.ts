import type { Database } from '@chat/db';
import type { Kysely } from 'kysely';
import webpush from 'web-push';
import type { Logger } from './logger.js';
import type { Notification, NotificationProvider } from './notifications.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** How long the push service keeps the push for an unreachable browser, and how urgent it is. */
export interface PushOptions {
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

/** Sends one payload to one browser. The web-push library in production; a fake in tests. */
export type PushSender = (
  target: PushTarget,
  payload: string,
  options?: PushOptions,
) => Promise<unknown>;

export function createWebPushSender(vapid: {
  subject: string;
  publicKey: string;
  privateKey: string;
}): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  // Default TTL: a message push that cannot be delivered within a day is no longer news.
  return (target, payload, options) =>
    webpush.sendNotification(target, payload, {
      TTL: options?.ttlSeconds ?? 86_400,
      urgency: options?.urgency,
    });
}

// The push service says "this subscription no longer exists" with 404 or 410.
export const isGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
};

/**
 * Sends a payload to every working subscription of a user. A 404/410 disables that subscription
 * (it never comes back by itself). Any other failure is remembered and thrown at the end, so
 * pg-boss retries the job. Returns how many browsers accepted the push.
 */
export async function pushToUser(
  db: Kysely<Database>,
  sender: PushSender,
  logger: Logger,
  userId: string,
  payload: string,
  options?: PushOptions,
): Promise<number> {
  const subscriptions = await db
    .selectFrom('push_subscriptions')
    .select(['id', 'endpoint', 'p256dh', 'auth'])
    .where('user_id', '=', userId)
    .where('disabled_at', 'is', null)
    .execute();

  let failure: Error | undefined;
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await sender(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        options,
      );
      sent++;
    } catch (error) {
      if (isGone(error)) {
        await db
          .updateTable('push_subscriptions')
          .set({ disabled_at: new Date() })
          .where('id', '=', sub.id)
          .execute();
        logger.info({ subscriptionId: sub.id }, 'push subscription gone, disabled');
      } else {
        failure = error instanceof Error ? error : new Error(String(error));
        logger.warn({ err: error, subscriptionId: sub.id }, 'push failed, will retry');
      }
    }
  }
  if (failure) throw failure;
  return sent;
}

/**
 * Real Web Push for messages. A retry may re-send to a browser that already got it; the payload
 * carries message_id so the service worker can use it as the notification tag and show it once.
 */
export class WebPushNotificationProvider implements NotificationProvider {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly sender: PushSender,
    private readonly logger: Logger,
  ) {}

  async send(n: Notification): Promise<void> {
    const payload = JSON.stringify({
      title: n.sender_name,
      body: n.excerpt,
      conversation_id: n.conversation_id,
      message_id: n.message_id,
    });
    await pushToUser(this.db, this.sender, this.logger, n.user_id, payload);
  }
}
