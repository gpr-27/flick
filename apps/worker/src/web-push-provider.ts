import type { Database } from '@chat/db';
import type { Kysely } from 'kysely';
import webpush from 'web-push';
import type { Logger } from './logger.js';
import type { Notification, NotificationProvider } from './notifications.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one payload to one browser. The web-push library in production; a fake in tests. */
export type PushSender = (target: PushTarget, payload: string) => Promise<unknown>;

export function createWebPushSender(vapid: {
  subject: string;
  publicKey: string;
  privateKey: string;
}): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  // TTL: a push that cannot be delivered within a day is no longer news.
  return (target, payload) => webpush.sendNotification(target, payload, { TTL: 86_400 });
}

// The push service says "this subscription no longer exists" with 404 or 410.
const isGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
};

/**
 * Real Web Push. Sends to every working subscription of the user. A 404/410 disables that
 * subscription (it never comes back by itself). Any other failure is remembered and thrown at
 * the end, so pg-boss retries the job. A retry may re-send to a browser that already got it;
 * the payload carries message_id so the service worker can use it as the notification tag and
 * show it once.
 */
export class WebPushNotificationProvider implements NotificationProvider {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly sender: PushSender,
    private readonly logger: Logger,
  ) {}

  async send(n: Notification): Promise<void> {
    const subscriptions = await this.db
      .selectFrom('push_subscriptions')
      .select(['id', 'endpoint', 'p256dh', 'auth'])
      .where('user_id', '=', n.user_id)
      .where('disabled_at', 'is', null)
      .execute();

    const payload = JSON.stringify({
      title: n.sender_name,
      body: n.excerpt,
      conversation_id: n.conversation_id,
      message_id: n.message_id,
    });

    let failure: Error | undefined;
    for (const sub of subscriptions) {
      try {
        await this.sender(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (error) {
        if (isGone(error)) {
          await this.db
            .updateTable('push_subscriptions')
            .set({ disabled_at: new Date() })
            .where('id', '=', sub.id)
            .execute();
          this.logger.info({ subscriptionId: sub.id }, 'push subscription gone, disabled');
        } else {
          failure = error instanceof Error ? error : new Error(String(error));
          this.logger.warn({ err: error, subscriptionId: sub.id }, 'push failed, will retry');
        }
      }
    }
    if (failure) throw failure;
  }
}
