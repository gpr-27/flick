import { useEffect } from 'react';
import { getTransport } from '@/lib/services';
import { useChatStore } from '@/features/chat/useChatStore';
import { useNotificationStore } from './useNotificationStore';

/**
 * Keeps the bell right while someone is signed in: loads the count at start, adds to it when the
 * server says a new alert exists, and re-reads it when the app returns to the front or the open
 * chat changes (reading a chat marks its alerts read on the server).
 */
export function useNotificationBindings(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const store = useNotificationStore;
    void store.getState().refreshUnread();

    const stopEvent = getTransport().on('notification_created', () => {
      // The list (if it was opened) is reloaded so the new alert appears at the top.
      if (store.getState().status === 'ready') void store.getState().load();
      else void store.getState().refreshUnread();
    });
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void store.getState().refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopChat = useChatStore.subscribe((now, before) => {
      if (now.selectedId === before.selectedId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void store.getState().refreshUnread(), 1_500);
    });
    return () => {
      stopEvent();
      stopChat();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      store.getState().reset();
    };
  }, [userId]);
}
