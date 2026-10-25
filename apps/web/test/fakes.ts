import { vi, type Mock } from 'vitest';
import type { Ack, ConversationSummary, MessageRecord, SyncEvent } from '@chat/contracts';
import type { Api } from '@/lib/api';
import { TypedEmitter } from '@/lib/realtime/emitter';
import type {
  ClientEvents,
  FireEvent,
  RequestData,
  RequestEvent,
  ServerEvents,
} from '@/lib/realtime/events';
import type { ConnectionState, StateListener } from '@/lib/realtime/stateMachine';
import type { RealtimeTransport } from '@/lib/realtime/transport';
import { configureServices } from '@/lib/services';

export interface SentEvent {
  type: keyof ClientEvents;
  payload: unknown;
}

interface PendingRequest {
  type: RequestEvent;
  resolve: (ack: Ack<never>) => void;
}

export const ok = <T>(data: T): Ack<T> => ({ ok: true, data });

/**
 * In-memory RealtimeTransport: records sends and requests, lets tests fire server events,
 * change the state and answer requests. delivery_ack and read_ack are answered at once; any
 * other request waits for `reply()`.
 */
export class FakeTransport implements RealtimeTransport {
  state: ConnectionState = 'connected';
  /** When false, send() returns false and request() fails with OFFLINE. */
  open = true;
  readonly sent: SentEvent[] = [];
  readonly connect: Mock<() => void> = vi.fn();
  readonly disconnect: Mock<() => void> = vi.fn();
  private readonly events = new TypedEmitter<ServerEvents>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly pending: PendingRequest[] = [];

  send<K extends FireEvent>(type: K, payload: ClientEvents[K]): boolean {
    if (!this.open) return false;
    this.sent.push({ type, payload });
    return true;
  }

  request<K extends RequestEvent>(type: K, payload: ClientEvents[K]): Promise<Ack<RequestData<K>>> {
    if (!this.open) {
      const error = { code: 'OFFLINE', message: 'Not connected.', retryable: true };
      return Promise.resolve({ ok: false, error });
    }
    this.sent.push({ type, payload });
    if (type === 'delivery_ack' || type === 'read_ack') {
      return Promise.resolve(ok(null) as Ack<RequestData<K>>);
    }
    return new Promise((resolve) => {
      this.pending.push({ type, resolve: resolve });
    });
  }

  /** Answer the oldest unanswered request of this type, then let its handlers run. */
  async reply<K extends RequestEvent>(type: K, ack: Ack<RequestData<K>>): Promise<void> {
    const index = this.pending.findIndex((p) => p.type === type);
    if (index < 0) throw new Error(`No pending "${type}" request`);
    const [request] = this.pending.splice(index, 1);
    request?.resolve(ack as Ack<never>);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  on<K extends keyof ServerEvents>(
    type: K,
    handler: (payload: ServerEvents[K]) => void,
  ): () => void {
    return this.events.on(type, handler);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  fire<K extends keyof ServerEvents>(type: K, payload: ServerEvents[K]): void {
    this.events.emit(type, payload);
  }

  setState(next: ConnectionState): void {
    const previous = this.state;
    this.state = next;
    for (const l of [...this.stateListeners]) l(next, previous);
  }

  sentOf<K extends keyof ClientEvents>(type: K): ClientEvents[K][] {
    return this.sent.filter((e) => e.type === type).map((e) => e.payload as ClientEvents[K]);
  }
}

export interface FakeApi {
  call: Mock<(...args: unknown[]) => Promise<unknown>>;
}

/** An Api whose calls resolve to `undefined` unless the test sets an implementation. */
export const fakeApi = (): FakeApi => ({ call: vi.fn(() => Promise.resolve(undefined)) });

export const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

export const installFakeServices = (transport = new FakeTransport(), api: FakeApi = fakeApi()) => {
  configureServices({ api: api as unknown as Api, transport });
  return { transport, api };
};

// ── data builders ──────────────────────────────────────────────────────────

const uuid = (n: number): string => `0192f5a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
let counter = 100;
export const nextId = (): string => uuid(counter++);
export const ME = uuid(1);
export const BOB = uuid(2);
export const CONV = uuid(50);

export const makeMessage = (overrides: Partial<MessageRecord> = {}): MessageRecord => {
  const n = counter++;
  return {
    message_id: uuid(n),
    conversation_id: CONV,
    seq: 1,
    sender_user_id: BOB,
    client_message_id: `client_msg_${n}`,
    content: { type: 'text', text: `message ${n}` },
    created_at: new Date(Date.UTC(2026, 0, 1, 12, 0, n % 60)).toISOString(),
    edited_at: null,
    deleted_at: null,
    expires_at: null,
    reactions: [],
    starred: false,
    viewed: false,
    ...overrides,
  };
};

export const newMessageEvent = (
  seq: number,
  overrides: Partial<MessageRecord> = {},
): SyncEvent => ({
  type: 'new_message',
  payload: { message: makeMessage({ seq, ...overrides }) },
});

export const makeConversation = (
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary => ({
  id: CONV,
  type: 'direct',
  is_saved: false,
  title: null,
  avatar_url: null,
  description: null,
  peer: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
  member_count: 2,
  my_role: 'member',
  last_seq: 0,
  read_seq: 0,
  unread_count: 0,
  last_message: null,
  peer_receipts: [],
  created_at: '2026-01-01T00:00:00.000Z',
  settings: {
    only_admins_send: false,
    only_admins_edit_info: false,
    approval_required: false,
    disappearing_timer_s: 0,
  },
  prefs: {
    archived: false,
    pinned: false,
    favorite: false,
    muted_until: null,
    locked: false,
    lock_hash: null,
    wallpaper: null,
  },
  ...overrides,
});

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
