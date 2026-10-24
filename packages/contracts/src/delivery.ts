import { z } from 'zod';

/**
 * The life of a message, in order. States never move backwards, which matches
 * the monotonic GREATEST() cursors in the database. A push notification does
 * not count as delivery; only the device's delivery_ack does.
 */
export const DELIVERY_STATES = [
  'CLIENT_PENDING', // in the client's outbox, not yet accepted
  'ACCEPTED_AND_PERSISTED', // transaction committed, message_accepted sent
  'EVENT_PUBLISHED', // outbox row published to chat.message.v1
  'DELIVERY_PENDING', // routed to recipients, or waiting for their next sync
  'DELIVERED_TO_DEVICE', // a recipient device sent delivery_ack
  'READ_BY_USER', // the recipient sent read_ack
] as const;

export const DeliveryState = z.enum(DELIVERY_STATES);
export type DeliveryState = z.infer<typeof DeliveryState>;

export function isForward(from: DeliveryState, to: DeliveryState): boolean {
  return DELIVERY_STATES.indexOf(to) > DELIVERY_STATES.indexOf(from);
}

/**
 * The ticks the sender sees for message `seq`, given each recipient's cursors.
 * delivered_seq is the highest delivered seq over all of that user's devices.
 */
export function tickState(
  seq: number,
  recipients: { delivered_seq: number; read_seq: number }[],
): 'sent' | 'delivered' | 'read' {
  if (recipients.length > 0 && recipients.every((r) => r.read_seq >= seq)) return 'read';
  if (
    recipients.length > 0 &&
    recipients.every((r) => Math.max(r.delivered_seq, r.read_seq) >= seq)
  )
    return 'delivered';
  return 'sent';
}
