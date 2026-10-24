import { useEffect, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { Video } from 'lucide-react';
import type { MessageRecord } from '@chat/contracts';
import { useGroupCallStore } from '../useGroupCallStore';

/** "A group call is going" with a Join button, shown above the messages. */
export const GroupCallBanner = ({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: readonly MessageRecord[];
}) => {
  const status = useGroupCallStore((s) => s.status);
  // The server knows who is in the call right now. Ask when the chat opens, when a call message
  // arrives, and every 20 s while the banner could matter.
  const [active, setActive] = useState(false);
  const callMessages = messages.filter((m) => m.content?.type === 'call_event').length;
  useEffect(() => {
    let cancelled = false;
    const check = (): void => {
      getApi()
        .call(ENDPOINTS.calls.groupPresence, { params: { conversation_id: conversationId } })
        .then((r) => {
          if (!cancelled) setActive(r.active);
        })
        .catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, callMessages, status]);
  if (!active || status !== 'idle') return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2 text-sm"
    >
      <span className="flex items-center gap-2 font-medium">
        <Video className="size-4 text-primary" aria-hidden="true" />A group call is in progress
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm rounded-full"
        onClick={() => void useGroupCallStore.getState().join({ conversation_id: conversationId })}
      >
        Join call
      </button>
    </div>
  );
};
