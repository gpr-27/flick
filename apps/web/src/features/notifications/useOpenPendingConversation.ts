import { useEffect } from 'react';
import { usePendingOpen } from '@/pwa/openFromNotification';
import { useChatStore } from '@/features/chat/useChatStore';

/** Opens the conversation a clicked notification pointed at, once the chat list has loaded. */
export const useOpenPendingConversation = (): void => {
  const pendingId = usePendingOpen((s) => s.conversationId);
  const listStatus = useChatStore((s) => s.listStatus);
  const known = useChatStore((s) => (pendingId ? pendingId in s.conversations : false));

  useEffect(() => {
    if (!pendingId || listStatus !== 'ready') return;
    if (known) useChatStore.getState().select(pendingId);
    // Not in the list (left the chat, or a stale link): drop it rather than keep waiting.
    usePendingOpen.setState({ conversationId: null });
  }, [pendingId, listStatus, known]);
};
