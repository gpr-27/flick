// Connection-state machine shared by every transport adapter. Pure transition
// function + a tiny observable holder, so the banner, the stores and the tests
// all agree on exactly one definition of "reconnecting" and "offline".

export type ConnectionState =
  /** Not started, or deliberately disconnected (signed out). */
  | 'idle'
  /** First connection attempt in progress. */
  | 'connecting'
  | 'connected'
  /** Lost the link (or the first attempt failed) and retrying. */
  | 'reconnecting'
  /** The browser reports no network; retrying resumes when it returns. */
  | 'offline';

export type ConnectionEvent =
  | { type: 'CONNECT'; online: boolean }
  | { type: 'OPEN' }
  | { type: 'CLOSE'; willReconnect: boolean }
  | { type: 'CONNECT_ERROR' }
  | { type: 'NETWORK_OFFLINE' }
  | { type: 'NETWORK_ONLINE' }
  | { type: 'DISCONNECT' };

export const nextConnectionState = (
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState => {
  switch (event.type) {
    case 'CONNECT':
      if (state !== 'idle') return state;
      return event.online ? 'connecting' : 'offline';
    case 'OPEN':
      return state === 'idle' ? state : 'connected';
    case 'CLOSE':
      if (state === 'idle' || state === 'offline') return state;
      return event.willReconnect ? 'reconnecting' : 'idle';
    case 'CONNECT_ERROR':
      return state === 'connecting' || state === 'connected' ? 'reconnecting' : state;
    case 'NETWORK_OFFLINE':
      return state === 'idle' ? state : 'offline';
    case 'NETWORK_ONLINE':
      return state === 'offline' ? 'reconnecting' : state;
    case 'DISCONNECT':
      return 'idle';
  }
};

export type StateListener = (state: ConnectionState, previous: ConnectionState) => void;

export class ConnectionStateMachine {
  private current: ConnectionState = 'idle';
  private readonly listeners = new Set<StateListener>();

  get state(): ConnectionState {
    return this.current;
  }

  dispatch(event: ConnectionEvent): ConnectionState {
    const previous = this.current;
    const next = nextConnectionState(previous, event);
    if (next !== previous) {
      this.current = next;
      for (const listener of [...this.listeners]) listener(next, previous);
    }
    return next;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
