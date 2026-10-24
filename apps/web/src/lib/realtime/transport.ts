import type { Ack } from '@chat/contracts';
import type { ClientEvents, FireEvent, RequestData, RequestEvent, ServerEvents } from './events';
import type { ConnectionState, StateListener } from './stateMachine';

export type Unsubscribe = () => void;

/**
 * Everything the app needs from a realtime connection. Stores talk to this interface only;
 * the implementation (socketTransport.ts) is a Socket.IO client that owns auth and reconnects.
 *
 * Handlers registered with `on` survive reconnects.
 */
export interface RealtimeTransport {
  readonly state: ConnectionState;
  connect(): void;
  disconnect(): void;
  /** Fire and forget (typing, activity, call signalling). False when the socket is not connected. */
  send<K extends FireEvent>(type: K, payload: ClientEvents[K]): boolean;
  /**
   * Emit an event and wait for the server's acknowledgement. Never rejects: a timeout becomes
   * `{ ok: false, error: { code: 'TIMEOUT', retryable: true } }` and a missing connection becomes
   * `{ ok: false, error: { code: 'OFFLINE', retryable: true } }`.
   */
  request<K extends RequestEvent>(
    type: K,
    payload: ClientEvents[K],
    timeoutMs?: number,
  ): Promise<Ack<RequestData<K>>>;
  on<K extends keyof ServerEvents>(
    type: K,
    handler: (payload: ServerEvents[K]) => void,
  ): Unsubscribe;
  onStateChange(listener: StateListener): Unsubscribe;
}
