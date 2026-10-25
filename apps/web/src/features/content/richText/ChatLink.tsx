import type { ReactNode } from 'react';
import { usePendingOpen } from '@/pwa/openFromNotification';

/** A link that opens a chat inside the app (no new tab). Chats not in the list are ignored. */
export const ChatLink = ({ id, children }: { id: string; children: ReactNode }) => (
  <button
    type="button"
    className="link link-primary"
    onClick={() => {
      usePendingOpen.setState({ conversationId: id });
    }}
  >
    {children}
  </button>
);
