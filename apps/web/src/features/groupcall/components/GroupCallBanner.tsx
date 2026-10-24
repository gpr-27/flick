import { useMemo } from 'react';
import { Video } from 'lucide-react';
import type { MessageRecord } from '@chat/contracts';
import { findActiveGroupCall } from '../activeCall';
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
  const active = useMemo(() => findActiveGroupCall(messages), [messages]);
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
