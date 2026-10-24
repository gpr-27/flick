// Opening a conversation from a notification. Two entry points land here:
//   - a cold start at `/?c=<conversation_id>` (the SW opened a new window);
//   - a message from the SW to an already open window.
// The app may not have its chat list yet, so the id is parked in a tiny store and the chat view
// picks it up when the conversation exists.
import { create } from 'zustand';

interface PendingOpen {
  conversationId: string | null;
}

export const usePendingOpen = create<PendingOpen>()(() => ({ conversationId: null }));

/** `?c=<id>` from a URL or search string, or null. */
export const conversationIdFromUrl = (url: string): string | null => {
  try {
    return new URL(url, 'http://app.local').searchParams.get('c');
  } catch {
    return null;
  }
};

/** Read `?c=` once at startup and clean the address bar. */
export const consumeLaunchParam = (): void => {
  const id = conversationIdFromUrl(window.location.href);
  if (!id) return;
  usePendingOpen.setState({ conversationId: id });
  window.history.replaceState(null, '', window.location.pathname);
};

export const handleServiceWorkerMessage = (event: MessageEvent): void => {
  const data = event.data as { type?: string; url?: string } | null;
  if (data?.type !== 'open-url' || typeof data.url !== 'string') return;
  const id = conversationIdFromUrl(data.url);
  if (id) usePendingOpen.setState({ conversationId: id });
};
