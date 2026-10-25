import type { Logger } from './logger.js';

/** What a notification is about. The words are built from this, per device (see push-payload.ts). */
export interface Notification {
  user_id: string;
  conversation_id: string;
  message_id: string;
  seq: number;
  /** Why the person is alerted: mention and reply get through a muted chat. */
  kind: 'message' | 'mention' | 'reply';
  sender_name: string;
  /** The group's name, or null in a 1:1 chat. */
  group_name: string | null;
  type: string;
  body_text: string | null;
  view_once: boolean;
}

/**
 * What happened to one notification, for the log line and the metrics. Only hosts and HTTP status
 * codes: never an endpoint or a key.
 */
export interface PushSummary {
  /** Working subscriptions the person has. */
  subscriptions: number;
  sent: number;
  /** Devices that already had the message (their app received it live). */
  skipped_delivered: number;
  /** Devices inside their quiet hours. */
  skipped_quiet: number;
  /** Devices the push service said are gone (disabled now). */
  expired: number;
  failed: number;
  /** One entry per push attempt: which push service answered and with which status. */
  services: { host: string; status: number }[];
}

/** Anything that can tell a user about a message they have not seen. */
export interface NotificationProvider {
  /** Throws when delivery failed in a way worth retrying; pg-boss then retries the job. */
  send(notification: Notification): Promise<PushSummary>;
}

export const emptySummary = (): PushSummary => ({
  subscriptions: 0,
  sent: 0,
  skipped_delivered: 0,
  skipped_quiet: 0,
  expired: 0,
  failed: 0,
  services: [],
});

/**
 * SIMULATION ONLY. It writes a log line and sends nothing to any device or service.
 * It is used when no VAPID keys are configured, so the notify pipeline (decision, durable job,
 * retry) still runs end to end in development. Never present it as a real push.
 */
export class SimulatedLogNotificationProvider implements NotificationProvider {
  constructor(private readonly logger: Logger) {}

  send(notification: Notification): Promise<PushSummary> {
    this.logger.info(
      {
        simulated: true,
        userId: notification.user_id,
        conversationId: notification.conversation_id,
        seq: notification.seq,
      },
      'SIMULATED notification (no push was sent)',
    );
    return Promise.resolve(emptySummary());
  }
}
