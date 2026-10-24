import type { z } from 'zod';
import type { ErrorBody } from '../errors.js';
import type { MessageAccepted } from '../message.js';
import { SendMessageInput } from '../message.js';
import * as E from './events.js';

// The Socket.IO event map. Plain event names with a payload: no envelope, no version, no
// request ids. A Socket.IO acknowledgement callback carries the answer to a request.

/**
 * What an acknowledgement callback receives. A failed send_message is `{ ok: false, error }`
 * with the error's `code` and `retryable` (the old message_failed).
 */
export type Ack<T = null> = { ok: true; data: T } | { ok: false; error: ErrorBody };

/** Payload schema of every event a client may send. The server validates with these. */
export const CLIENT_PAYLOADS = {
  send_message: SendMessageInput,
  delivery_ack: E.DeliveryAckPayload,
  read_ack: E.ReadAckPayload,
  sync_request: E.SyncRequestPayload,
  typing_start: E.TypingPayload,
  typing_stop: E.TypingPayload,
  activity: E.ActivityPayload,
  presence_subscribe: E.PresenceSubscribePayload,
  call_offer: E.CallOfferPayload,
  call_answer: E.CallAnswerPayload,
  call_ice: E.CallIcePayload,
  call_end: E.CallEndPayload,
  call_reject: E.CallRejectPayload,
  call_busy: E.CallBusyPayload,
  call_renegotiate: E.CallRenegotiatePayload,
} as const;

/** Payload schema of every event the server sends. */
export const SERVER_PAYLOADS = {
  new_message: E.NewMessagePayload,
  message_edited: E.MessageEditedPayload,
  message_deleted: E.MessageDeletedPayload,
  reaction_added: E.ReactionPayload,
  reaction_removed: E.ReactionPayload,
  receipt_update: E.ReceiptUpdatePayload,
  typing_start: E.TypingRelayPayload,
  typing_stop: E.TypingRelayPayload,
  activity: E.ActivityRelayPayload,
  presence_update: E.PresenceUpdatePayload,
  conversation_updated: E.ConversationUpdatedPayload,
  call_offer: E.RelayedCall.call_offer,
  call_answer: E.RelayedCall.call_answer,
  call_ice: E.RelayedCall.call_ice,
  call_end: E.RelayedCall.call_end,
  call_reject: E.RelayedCall.call_reject,
  call_busy: E.RelayedCall.call_busy,
  call_renegotiate: E.RelayedCall.call_renegotiate,
  call_unavailable: E.CallUnavailablePayload,
} as const;

type In<K extends keyof typeof CLIENT_PAYLOADS> = z.input<(typeof CLIENT_PAYLOADS)[K]>;
type Out<K extends keyof typeof SERVER_PAYLOADS> = z.infer<(typeof SERVER_PAYLOADS)[K]>;

/** Events the client emits. Use as the second type argument of the client socket. */
export interface ClientToServerEvents {
  send_message(p: In<'send_message'>, ack: (r: Ack<MessageAccepted>) => void): void;
  delivery_ack(p: In<'delivery_ack'>, ack?: (r: Ack) => void): void;
  read_ack(p: In<'read_ack'>, ack?: (r: Ack) => void): void;
  sync_request(
    p: In<'sync_request'>,
    ack: (r: Ack<z.infer<typeof E.SyncPagePayload>>) => void,
  ): void;
  typing_start(p: In<'typing_start'>): void;
  typing_stop(p: In<'typing_stop'>): void;
  activity(p: In<'activity'>): void;
  /** Replaces the watch list. The ack holds the current status of each allowed user. */
  presence_subscribe(
    p: In<'presence_subscribe'>,
    ack: (r: Ack<Out<'presence_update'>[]>) => void,
  ): void;
  call_offer(p: In<'call_offer'>): void;
  call_answer(p: In<'call_answer'>): void;
  call_ice(p: In<'call_ice'>): void;
  call_end(p: In<'call_end'>): void;
  call_reject(p: In<'call_reject'>): void;
  call_busy(p: In<'call_busy'>): void;
  call_renegotiate(p: In<'call_renegotiate'>): void;
}

/** Events the server emits. Use as the first type argument of the client socket. */
export type ServerToClientEvents = { [K in keyof typeof SERVER_PAYLOADS]: (p: Out<K>) => void };

// Compile-time check: every client event has a payload schema, and no schema is extra.
CLIENT_PAYLOADS satisfies { [K in keyof ClientToServerEvents]: z.ZodType };

/** For the `default:` branch of a switch: fails to compile if a case is missing. */
export function assertNever(value: never): never {
  throw new Error(`unhandled: ${JSON.stringify(value)}`);
}
