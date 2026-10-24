import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createSocketTransport,
  type NetworkSignal,
  type SocketLike,
  type SocketOptions,
} from './socketTransport';
import type { ConnectionState } from './stateMachine';

type Handler = (...args: unknown[]) => void;

/** A Socket.IO client double: tests call `trigger` to play the part of the server and network. */
class FakeSocket implements SocketLike {
  connected = false;
  active = false;
  readonly handlers = new Map<string, Handler>();
  readonly managerHandlers = new Map<string, Handler>();
  anyHandler: ((event: string, ...args: unknown[]) => void) | null = null;
  readonly emitted: { event: string; args: unknown[] }[] = [];
  readonly io = { on: (event: string, h: Handler) => void this.managerHandlers.set(event, h) };

  connect: Mock<() => void> = vi.fn(() => {
    this.active = true;
  });
  disconnect: Mock<() => void> = vi.fn(() => {
    this.connected = false;
    this.active = false;
  });
  on(event: string, h: Handler): void {
    this.handlers.set(event, h);
  }
  onAny(h: (event: string, ...args: unknown[]) => void): void {
    this.anyHandler = h;
  }
  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, args });
  }

  trigger(event: string, ...args: unknown[]): void {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    this.handlers.get(event)?.(...args);
  }
  /** The server answers the last emit that has an ack callback. */
  ack(answer: unknown): void {
    const last = this.emitted.at(-1);
    (last?.args.at(-1) as (a: unknown) => void)(answer);
  }
}

const network = (): NetworkSignal => ({ isOnline: () => true, subscribe: () => () => undefined });

let socket: FakeSocket;
let options: SocketOptions;
let unauthorized: Mock<() => void>;
let tokens: number;

const setup = () => {
  const transport = createSocketTransport({
    url: 'http://api.test',
    getAuth: () => Promise.resolve({ token: `token-${++tokens}`, deviceId: 'dev-1' }),
    onUnauthorized: unauthorized,
    network: network(),
    createSocket: (_url, o) => {
      options = o;
      return socket;
    },
  });
  const states: ConnectionState[] = [];
  transport.onStateChange((s) => states.push(s));
  return { transport, states };
};

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  unauthorized = vi.fn<() => void>();
  tokens = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connecting', () => {
  it('sends token and deviceId in the handshake, with a fresh token on every connect', async () => {
    setup();
    const handshake = async () =>
      new Promise<object>((resolve) => {
        options.auth(resolve);
      });
    expect(await handshake()).toEqual({ token: 'token-1', deviceId: 'dev-1' });
    expect(await handshake()).toEqual({ token: 'token-2', deviceId: 'dev-1' }); // a reconnect
  });

  it('uses websocket only, with exponential backoff and jitter', () => {
    setup();
    expect(options).toMatchObject({
      transports: ['websocket'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
  });

  it('walks idle -> connecting -> connected -> reconnecting -> connected', () => {
    const { transport, states } = setup();
    transport.connect();
    expect(socket.connect).toHaveBeenCalledOnce();
    socket.trigger('connect');
    socket.active = true;
    socket.trigger('disconnect', 'transport close');
    socket.managerHandlers.get('reconnect_attempt')?.();
    socket.trigger('connect');
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });

  it('stays reconnecting while connect_error repeats', () => {
    const { transport, states } = setup();
    transport.connect();
    socket.active = true;
    socket.trigger('connect_error', new Error('xhr poll error'));
    socket.trigger('connect_error', new Error('xhr poll error'));
    expect(states).toEqual(['connecting', 'reconnecting']);
  });

  it('connects again by itself when the server hangs up', () => {
    const { transport } = setup();
    transport.connect();
    socket.trigger('connect');
    socket.active = false; // Socket.IO does not reconnect after "io server disconnect"
    socket.trigger('disconnect', 'io server disconnect');
    vi.advanceTimersByTime(2_000);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it('disconnect() goes idle and does not reconnect', () => {
    const { transport, states } = setup();
    transport.connect();
    socket.trigger('connect');
    transport.disconnect();
    socket.trigger('disconnect', 'io client disconnect');
    vi.advanceTimersByTime(10_000);
    expect(states).toEqual(['connecting', 'connected', 'idle']);
    expect(socket.connect).toHaveBeenCalledOnce();
  });

  it('signs out on connect_error "unauthorized" and does not retry', () => {
    const { transport, states } = setup();
    transport.connect();
    socket.trigger('connect_error', new Error('unauthorized'));
    vi.advanceTimersByTime(10_000);
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(states).toEqual(['connecting', 'idle']);
    expect(socket.connect).toHaveBeenCalledOnce();
  });
});

describe('events', () => {
  it('passes server events to handlers, and ignores unknown ones', () => {
    const { transport } = setup();
    const handler = vi.fn();
    transport.on('typing_start', handler);
    const payload = { conversation_id: 'c1', user_id: 'u1' };
    socket.anyHandler?.('typing_start', payload);
    socket.anyHandler?.('something_new', {});
    expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('send() is a plain emit, and false while disconnected', () => {
    const { transport } = setup();
    expect(transport.send('typing_start', { conversation_id: 'c1' })).toBe(false);
    socket.trigger('connect');
    expect(transport.send('typing_start', { conversation_id: 'c1' })).toBe(true);
    expect(socket.emitted).toEqual([{ event: 'typing_start', args: [{ conversation_id: 'c1' }] }]);
  });
});

describe('request()', () => {
  const payload = { conversation_id: 'c1', seq: 3 };

  it('resolves with the ack, success or failure', async () => {
    const { transport } = setup();
    socket.trigger('connect');

    const success = transport.request('read_ack', payload);
    socket.ack({ ok: true, data: null });
    expect(await success).toEqual({ ok: true, data: null });

    const error = { code: 'NOT_A_MEMBER', message: 'No.', retryable: false };
    const failed = transport.request('read_ack', payload);
    socket.ack({ ok: false, error });
    expect(await failed).toEqual({ ok: false, error });
  });

  it('turns silence into a retryable TIMEOUT failure', async () => {
    const { transport } = setup();
    socket.trigger('connect');
    const result = transport.request('read_ack', payload, 20_000);
    vi.advanceTimersByTime(20_000);
    expect(await result).toMatchObject({ ok: false, error: { code: 'TIMEOUT', retryable: true } });
  });

  it('fails with OFFLINE at once when not connected, and when the connection drops', async () => {
    const { transport } = setup();
    expect(await transport.request('read_ack', payload)).toMatchObject({
      ok: false,
      error: { code: 'OFFLINE' },
    });

    transport.connect();
    socket.trigger('connect');
    const waiting = transport.request('read_ack', payload);
    socket.trigger('disconnect', 'transport close');
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'OFFLINE', retryable: true } });
  });
});
