import type { Database } from '@chat/db';
import type { Kysely } from 'kysely';
import webpush from 'web-push';
import type { Logger } from './logger.js';
import {
  emptySummary,
  type Notification,
  type NotificationProvider,
  type PushSummary,
} from './notifications.js';
import { inQuietHours, messagePushPayload, parsePrefs } from './push-payload.js';

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

/** A person's working subscriptions: not disabled, and not tied to a device that was signed out. */
export function activeSubscriptions(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom('push_subscriptions as s')
    .leftJoin('devices as d', 'd.id', 's.device_id')
    .select(['s.id', 's.endpoint', 's.p256dh', 's.auth', 's.device_id', 's.prefs'])
    .where('s.user_id', '=', userId)
    .where('s.disabled_at', 'is', null)
    .where((eb) => eb.or([eb('s.device_id', 'is', null), eb('d.revoked_at', 'is', null)]))
    .execute();
}

/** The push service's host, safe to log (the endpoint itself is a secret). */
export function serviceHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}

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
  const subscriptions = await activeSubscriptions(db, userId);

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
 * Real Web Push for messages. Each device gets its own payload (previews on/off, quiet hours) and
 * is skipped if it already has the message. A retry may re-send to a browser that already got it;
 * the payload carries message_id so the service worker counts each message once.
 */
export class WebPushNotificationProvider implements NotificationProvider {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly sender: PushSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(n: Notification): Promise<PushSummary> {
    const summary = emptySummary();
    const subscriptions = await activeSubscriptions(this.db, n.user_id);
    summary.subscriptions = subscriptions.length;

    // Devices whose app already received this message live (their delivery receipt is in).
    const deviceIds = subscriptions.flatMap((s) => (s.device_id ? [s.device_id] : []));
    const delivered = new Set(
      deviceIds.length === 0
        ? []
        : (
            await this.db
              .selectFrom('device_cursors')
              .select('device_id')
              .where('device_id', 'in', deviceIds)
              .where('conversation_id', '=', n.conversation_id)
              .where('delivered_seq', '>=', n.seq)
              .execute()
          ).map((r) => r.device_id),
    );

    let failure: Error | undefined;
    for (const sub of subscriptions) {
      if (sub.device_id && delivered.has(sub.device_id)) {
        summary.skipped_delivered++;
        continue;
      }
      const prefs = parsePrefs(sub.prefs);
      if (inQuietHours(prefs, this.now())) {
        summary.skipped_quiet++;
        continue;
      }
      const host = serviceHost(sub.endpoint);
      let status: number;
      try {
        const result = await this.sender(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          messagePushPayload(n, prefs),
          // High urgency wakes a sleeping phone at once; the TTL keeps old news out.
          { urgency: 'high', ttlSeconds: 86_400 },
        );
        status = (result as { statusCode?: number } | undefined)?.statusCode ?? 201;
        summary.sent++;
      } catch (error) {
        status = (error as { statusCode?: number }).statusCode ?? 0;
        if (isGone(error)) summary.expired++;
        else {
          summary.failed++;
          failure = error instanceof Error ? error : new Error(String(error));
        }
      }
      summary.services.push({ host, status });
      await this.db
        .updateTable('push_subscriptions')
        .set({
          last_attempt_at: this.now(),
          last_status: status,
          ...(status >= 200 && status < 300 ? { last_success_at: this.now() } : {}),
          ...(status === 404 || status === 410 ? { disabled_at: this.now() } : {}),
        })
        .where('id', '=', sub.id)
        .execute();
    }
    // The error carries what happened, so the notify job can log it before the retry.
    if (failure) throw Object.assign(failure, { summary });
    return summary;
  }
}
