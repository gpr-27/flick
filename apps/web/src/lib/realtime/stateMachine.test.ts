import { describe, expect, it, vi } from 'vitest';
import {
  ConnectionStateMachine,
  nextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from './stateMachine';

describe('nextConnectionState', () => {
  const cases: [ConnectionState, ConnectionEvent, ConnectionState][] = [
    ['idle', { type: 'CONNECT', online: true }, 'connecting'],
    ['idle', { type: 'CONNECT', online: false }, 'offline'],
    ['connected', { type: 'CONNECT', online: true }, 'connected'],
    ['connecting', { type: 'OPEN' }, 'connected'],
    ['reconnecting', { type: 'OPEN' }, 'connected'],
    ['offline', { type: 'OPEN' }, 'connected'],
    ['idle', { type: 'OPEN' }, 'idle'],
    ['connected', { type: 'CLOSE', willReconnect: true }, 'reconnecting'],
    ['connected', { type: 'CLOSE', willReconnect: false }, 'idle'],
    ['offline', { type: 'CLOSE', willReconnect: true }, 'offline'],
    ['idle', { type: 'CLOSE', willReconnect: true }, 'idle'],
    ['connecting', { type: 'CONNECT_ERROR' }, 'reconnecting'],
    ['reconnecting', { type: 'CONNECT_ERROR' }, 'reconnecting'],
    ['offline', { type: 'CONNECT_ERROR' }, 'offline'],
    ['connected', { type: 'NETWORK_OFFLINE' }, 'offline'],
    ['reconnecting', { type: 'NETWORK_OFFLINE' }, 'offline'],
    ['idle', { type: 'NETWORK_OFFLINE' }, 'idle'],
    ['offline', { type: 'NETWORK_ONLINE' }, 'reconnecting'],
    ['connected', { type: 'NETWORK_ONLINE' }, 'connected'],
    ['connected', { type: 'DISCONNECT' }, 'idle'],
    ['offline', { type: 'DISCONNECT' }, 'idle'],
  ];

  it.each(cases)('%s + %o -> %s', (from, event, to) => {
    expect(nextConnectionState(from, event)).toBe(to);
  });
});

describe('ConnectionStateMachine', () => {
  it('notifies only on actual changes, with the previous state', () => {
    const machine = new ConnectionStateMachine();
    const listener = vi.fn();
    machine.subscribe(listener);

    machine.dispatch({ type: 'CONNECT', online: true });
    machine.dispatch({ type: 'OPEN' });
    machine.dispatch({ type: 'OPEN' }); // no-op
    machine.dispatch({ type: 'CLOSE', willReconnect: true });

    expect(listener.mock.calls).toEqual([
      ['connecting', 'idle'],
      ['connected', 'connecting'],
      ['reconnecting', 'connected'],
    ]);
    expect(machine.state).toBe('reconnecting');
  });

  it('stops notifying after unsubscribe', () => {
    const machine = new ConnectionStateMachine();
    const listener = vi.fn();
    const off = machine.subscribe(listener);
    off();
    machine.dispatch({ type: 'CONNECT', online: true });
    expect(listener).not.toHaveBeenCalled();
  });

  it('walks a full offline round trip', () => {
    const machine = new ConnectionStateMachine();
    const seen: ConnectionState[] = [];
    machine.subscribe((s) => seen.push(s));
    machine.dispatch({ type: 'CONNECT', online: true });
    machine.dispatch({ type: 'OPEN' });
    machine.dispatch({ type: 'NETWORK_OFFLINE' });
    machine.dispatch({ type: 'CLOSE', willReconnect: true }); // socket notices later: stays offline
    machine.dispatch({ type: 'NETWORK_ONLINE' });
    machine.dispatch({ type: 'OPEN' });
    expect(seen).toEqual(['connecting', 'connected', 'offline', 'reconnecting', 'connected']);
  });
});
