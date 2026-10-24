// RealtimeTransport on Socket.IO (docs/messaging/protocol.md).
//
// Socket.IO already does the hard parts: heartbeats, reconnect with exponential backoff and
// jitter, and acknowledgement callbacks. This file only maps its events onto the app's
// connection-state machine, and wraps acknowledgements in promises.
//
// The Clerk token goes in the handshake `auth`. `auth` is a function, so every connect and
// reconnect sends a fresh token.
import { io } from 'socket.io-client';
import type { Ack } from '@chat/contracts';
import { logger } from '@/lib/logger';
import { TypedEmitter } from './emitter';
import type { ServerEvents } from './events';
import { ConnectionStateMachine, type StateListener } from './stateMachine';
import type { RealtimeTransport, Unsubscribe } from './transport';

type Handler = (...args: unknown[]) => void;

/** The part of a Socket.IO client this module uses (tests pass a fake). */
export interface SocketLike {
  readonly connected: boolean;
  /** True while Socket.IO will keep reconnecting by itself. */
  readonly active: boolean;
  readonly io: { on(event: string, handler: Handler): unknown };
  connect(): unknown;
  disconnect(): unknown;
  on(event: string, handler: Handler): unknown;
  onAny(handler: (event: string, ...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

export interface SocketOptions {
  autoConnect: false;
  transports: ['websocket'];
  auth: (cb: (data: object) => void) => void;
  reconnectionDelay: number;
  reconnectionDelayMax: number;
  randomizationFactor: number;
}

export interface NetworkSignal {
  isOnline(): boolean;
  subscribe(onOnline: () => void, onOffline: () => void): () => void;
}

export const browserNetwork: NetworkSignal = {
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  subscribe(onOnline, onOffline) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  },
};

export interface SocketTransportOptions {
  /** The API origin. */
  url: string;
  /** The handshake auth: a fresh `{ token, deviceId }` every time it is called. */
  getAuth: () => Promise<object>;
  /** The server refused our token: the session is over (sign out). */
  onUnauthorized: () => void;
  createSocket?: (url: string, options: SocketOptions) => SocketLike;
  network?: NetworkSignal;
}

/** An unanswered request becomes a retryable failure after this long. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** When Socket.IO gave up reconnecting by itself (the server hung up), try again after this. */
const MANUAL_RETRY_MS = 2_000;

const failure = (code: 'TIMEOUT' | 'OFFLINE', message: string): Ack<never> => ({
  ok: false,
  error: { code, message, retryable: true },
});

export const createSocketTransport = (options: SocketTransportOptions): RealtimeTransport => {
  const network = options.network ?? browserNetwork;
  const machine = new ConnectionStateMachine();
  const events = new TypedEmitter<ServerEvents>();
  const socket = (options.createSocket ?? ((url, opts) => io(url, opts)))(options.url, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => {
      // No token (signed out) goes to the server as "{}" and comes back as `unauthorized`.
      options.getAuth().then(cb, () => {
        cb({});
      });
    },
    // Exponential backoff with jitter: about 0.5 s, 1 s, 2 s ... capped at 30 s, each +-50%.
    reconnectionDelay: 500,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });

  /** Requests waiting for an answer; each one fails with OFFLINE when the connection drops. */
  const pending = new Set<() => void>();
  /** True between connect() and disconnect(): the app wants a connection. */
  let wanted = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopNetwork: (() => void) | null = null;

  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const retrySoon = (): void => {
    if (!wanted || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wanted && !socket.connected) socket.connect();
    }, MANUAL_RETRY_MS);
  };

  socket.on('connect', () => {
    clearRetry();
    machine.dispatch({ type: 'OPEN' });
  });
  socket.on('disconnect', () => {
    for (const abort of [...pending]) abort();
    if (!wanted) return;
    machine.dispatch({ type: 'CLOSE', willReconnect: true });
    if (!socket.active) retrySoon(); // the server hung up: Socket.IO will not reconnect itself
  });
  socket.on('connect_error', (error) => {
    if ((error as Error | undefined)?.message === 'unauthorized') {
      transport.disconnect();
      options.onUnauthorized();
      return;
    }
    machine.dispatch({ type: 'CONNECT_ERROR' });
    if (!socket.active) retrySoon();
  });
  socket.io.on('reconnect_attempt', () => {
    machine.dispatch({ type: 'CONNECT_ERROR' });
  });
  // Every server event goes to the handlers registered with on(); unknown names have none.
  socket.onAny((event, payload) => {
    events.emit(event as keyof ServerEvents, payload as never);
  });

  const transport: RealtimeTransport = {
    get state() {
      return machine.state;
    },

    connect() {
      if (wanted) return;
      wanted = true;
      stopNetwork ??= network.subscribe(
        () => {
          machine.dispatch({ type: 'NETWORK_ONLINE' });
          // The network is back: do not wait out the backoff.
          if (wanted && !socket.connected) socket.connect();
        },
        () => {
          machine.dispatch({ type: 'NETWORK_OFFLINE' });
        },
      );
      machine.dispatch({ type: 'CONNECT', online: network.isOnline() });
      socket.connect();
    },

    disconnect() {
      wanted = false;
      clearRetry();
      stopNetwork?.();
      stopNetwork = null;
      socket.disconnect();
      machine.dispatch({ type: 'DISCONNECT' });
    },

    send(type, payload) {
      if (!socket.connected) return false;
      socket.emit(type, payload);
      return true;
    },

    request(type, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
      return new Promise((resolve) => {
        if (!socket.connected) {
          resolve(failure('OFFLINE', 'Not connected.'));
          return;
        }
        const finish = (answer: Ack<never>): void => {
          clearTimeout(timer);
          pending.delete(abort);
          resolve(answer);
        };
        const abort = (): void => {
          finish(failure('OFFLINE', 'The connection dropped.'));
        };
        const timer = setTimeout(() => {
          logger.warn(`No answer to "${type}" in ${timeoutMs} ms`);
          finish(failure('TIMEOUT', 'The server did not answer.'));
        }, timeoutMs);
        pending.add(abort);
        socket.emit(type, payload, finish);
      });
    },

    on(type, handler) {
      return events.on(type, handler);
    },

    onStateChange(listener: StateListener): Unsubscribe {
      return machine.subscribe(listener);
    },
  };
  return transport;
};
