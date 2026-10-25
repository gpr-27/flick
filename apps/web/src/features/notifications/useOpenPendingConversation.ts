import { useEffect } from 'react';
import { usePendingOpen } from '@/pwa/openFromNotification';
import { useChatStore } from '@/features/chat/useChatStore';
import { useJumpStore } from '@/features/organise/jump';

/** Opens the conversation a clicked notification pointed at, once the chat list has loaded. */
export const useOpenPendingConversation = (): void => {
  const pendingId = usePendingOpen((s) => s.conversationId);
  const listStatus = useChatStore((s) => s.listStatus);
  const known = useChatStore((s) => (pendingId ? pendingId in s.conversations : false));

  useEffect(() => {
    if (!pendingId || listStatus !== 'ready') return;
    const { messageId, seq } = usePendingOpen.getState();
    if (known) {
      // A tapped notification points at a message: open the chat scrolled to it.
      if (messageId && seq !== null) {
        useJumpStore.getState().jumpTo({ conversation_id: pendingId, message_id: messageId, seq });
      } else {
        useChatStore.getState().select(pendingId);
      }
    }
    // Not in the list (left the chat, or a stale link): drop it rather than keep waiting.
    usePendingOpen.setState({ conversationId: null, messageId: null, seq: null });
  }, [pendingId, listStatus, known]);
};
