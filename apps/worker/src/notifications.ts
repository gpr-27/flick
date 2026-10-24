import type { Logger } from './logger.js';

/** What a notification says. Deliberately small: no full message text, no member list. */
export interface Notification {
  user_id: string;
  conversation_id: string;
  message_id: string;
  seq: number;
  sender_name: string;
  excerpt: string;
}

/** Anything that can tell a user about a message they have not seen. */
export interface NotificationProvider {
  /** Throws when delivery failed in a way worth retrying; pg-boss then retries the job. */
  send(notification: Notification): Promise<void>;
}

/**
 * SIMULATION ONLY. It writes a log line and sends nothing to any device or service.
 * It is used when no VAPID keys are configured, so the notify pipeline (decision, durable job,
 * retry) still runs end to end in development. Never present it as a real push.
 */
export class SimulatedLogNotificationProvider implements NotificationProvider {
  constructor(private readonly logger: Logger) {}

  send(notification: Notification): Promise<void> {
    this.logger.info(
      {
        simulated: true,
        userId: notification.user_id,
        conversationId: notification.conversation_id,
        seq: notification.seq,
      },
      'SIMULATED notification (no push was sent)',
    );
    return Promise.resolve();
  }
}
