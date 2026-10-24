// Keeps the browser tab title ("(3) Flick") and the app icon badge in step with unread messages.
import { useEffect } from 'react';
import { useChatStore } from '../chat/useChatStore';
import { setAppBadge, titleWithUnread, totalUnread } from './unreadTotal';

export const useUnreadIndicators = (): void => {
  const conversations = useChatStore((s) => s.conversations);
  const total = totalUnread(Object.values(conversations));
  useEffect(() => {
    document.title = titleWithUnread(total);
    setAppBadge(total);
  }, [total]);
};
