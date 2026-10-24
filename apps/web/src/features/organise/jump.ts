// "Go to this message" for search results, pinned messages and starred messages.
//
// The API has no "messages around seq N" call: history only pages backwards from the newest. So
// a jump opens the chat, then keeps loading older pages until the message is in the thread. Each
// page is a keyset step, and the thread stays one contiguous run of messages.
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { MessageRecord } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { useChatStore } from '../chat/useChatStore';

interface Target {
  conversationId: string;
  messageId: string;
  seq: number;
}

interface JumpState {
  target: Target | null;
  /** The message to flash after a jump, so the reader can see where it landed. */
  flashId: string | null;
  jumpTo: (message: Pick<MessageRecord, 'conversation_id' | 'message_id' | 'seq'>) => void;
  clear: () => void;
  flash: (messageId: string) => void;
}

export const useJumpStore = create<JumpState>()((set) => ({
  target: null,
  flashId: null,
  jumpTo: (m) => {
    useChatStore.getState().select(m.conversation_id);
    set({ target: { conversationId: m.conversation_id, messageId: m.message_id, seq: m.seq } });
  },
  clear: () => {
    set({ target: null });
  },
  flash: (messageId) => {
    set({ flashId: messageId });
    setTimeout(() => {
      set((s) => (s.flashId === messageId ? { flashId: null } : s));
    }, 2000);
  },
}));

/** A stop for a failing network or a very old message: 20 pages is 1 000 messages. */
const MAX_PAGES = 20;

/** Runs inside the open chat: loads older pages until the target is there, then scrolls to it. */
export const useJumpEffect = (
  conversationId: string,
  scrollTo: (message: MessageRecord) => void,
): void => {
  const target = useJumpStore((s) =>
    s.target?.conversationId === conversationId ? s.target : null,
  );
  const thread = useChatStore((s) => s.threads[conversationId]);
  const pages = useRef(0);

  useEffect(() => {
    if (!target) pages.current = 0;
    if (!target || thread?.status !== 'ready') return;
    const { clear, flash } = useJumpStore.getState();
    const found = thread.messages.find((m) => m.message_id === target.messageId);
    if (found) {
      scrollTo(found);
      flash(found.message_id);
      clear();
      return;
    }
    const oldest = thread.messages[0];
    const passed = oldest !== undefined && oldest.seq <= target.seq;
    if (thread.hasOlder && !passed && pages.current < MAX_PAGES) {
      if (!thread.loadingOlder) {
        pages.current += 1;
        void useChatStore.getState().loadOlder(conversationId);
      }
      return;
    }
    // Deleted for you, expired, or never loaded.
    notify.info("That message isn't available any more.");
    clear();
  }, [target, thread, conversationId, scrollTo]);
};
