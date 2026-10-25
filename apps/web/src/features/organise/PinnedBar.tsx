import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { previewContent } from '../chat/content/registry';
import { useJumpStore } from './jump';
import { usePinsStore } from './messageActions';

/** Shows the pinned messages of a chat, one at a time; activating the bar jumps to it. */
export const PinnedBar = ({ conversationId }: { conversationId: string }) => {
  const pins = usePinsStore((s) => s.byConversation[conversationId]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    void usePinsStore.getState().load(conversationId);
  }, [conversationId]);

  useFeatureGuide('chat.pinned', Boolean(pins && pins.length > 0));
  if (!pins || pins.length === 0) return null;
  const current = pins[index % pins.length];
  if (!current) return null;

  return (
    <div
      data-guide="chat.pinned"
      className="flex items-center gap-2 border-b border-base-content/10 bg-base-content/5 px-4 py-1.5"
    >
      <Pin className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        aria-label={`Pinned message ${(index % pins.length) + 1} of ${pins.length}: ${previewContent(current.content)}. Go to message`}
        onClick={() => {
          markUsed('chat.pinned');
          useJumpStore.getState().jumpTo(current);
          // The next click goes to the next pin.
          setIndex((i) => (i + 1) % pins.length);
        }}
      >
        <span className="block text-[11px] font-semibold text-primary">
          Pinned message{pins.length > 1 ? ` (${(index % pins.length) + 1}/${pins.length})` : ''}
        </span>
        <span className="block truncate text-sm">{previewContent(current.content)}</span>
      </button>
    </div>
  );
};
