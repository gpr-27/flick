// Sends one Web Push from the API. Only "Send me a test notification" uses it; message pushes
// are sent by the worker (apps/worker/src/web-push-provider.ts).
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { Config } from '../../config.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Resolves with the push service's HTTP status; rejects with an error that may carry statusCode. */
export type PushSender = (
  target: PushTarget,
  payload: string,
  options: { ttlSeconds: number; urgency: 'normal' | 'high' },
) => Promise<{ statusCode: number }>;

/** null when the server has no VAPID keys (the test button then says so). */
export function createPushSender(config: Config): PushSender | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT } = config;
  if (!publicKey || !privateKey || !VAPID_SUBJECT) return null;
  const details = { subject: VAPID_SUBJECT, publicKey, privateKey };
  return async (target, payload, options) => {
    const result = await webpush.sendNotification(target, payload, {
      TTL: options.ttlSeconds,
      urgency: options.urgency,
      vapidDetails: details,
    });
    return { statusCode: result.statusCode };
  };
}

/** A short fingerprint of an endpoint, so the browser can ask "do you have my current one?". */
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

/** The push service's host (for example fcm.googleapis.com): safe to log and show, unlike the endpoint. */
export function pushServiceHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}
