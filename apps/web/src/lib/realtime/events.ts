// The realtime vocabulary is the Socket.IO event map in @chat/contracts: one entry per event,
// mapping to its payload. There is no second naming layer to keep in sync.
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@chat/contracts';

export type ServerEvents = {
  [K in keyof ServerToClientEvents]: Parameters<ServerToClientEvents[K]>[0];
};
export type ClientEvents = {
  [K in keyof ClientToServerEvents]: Parameters<ClientToServerEvents[K]>[0];
};

/** Client events that get an answer (an acknowledgement callback). */
export type RequestEvent =
  'send_message' | 'sync_request' | 'presence_subscribe' | 'delivery_ack' | 'read_ack';
/** Client events that are plain emits: typing, activity and call signalling. */
export type FireEvent = Exclude<keyof ClientToServerEvents, RequestEvent>;

/** The `data` of a successful answer to request event K. */
export type RequestData<K extends RequestEvent> =
  Parameters<NonNullable<Parameters<ClientToServerEvents[K]>[1]>>[0] extends Ack<infer D>
    ? D
    : never;

export type ServerEventName = keyof ServerEvents;
export type ClientEventName = keyof ClientEvents;
