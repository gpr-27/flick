import { useCallback, useSyncExternalStore } from 'react';
import { getTransport } from '../services';
import type { ConnectionState } from './stateMachine';

/** Live connection state of the app's realtime transport. */
export const useConnectionState = (): ConnectionState => {
  const subscribe = useCallback(
    (onChange: () => void) => getTransport().onStateChange(onChange),
    [],
  );
  const getSnapshot = useCallback(() => getTransport().state, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
