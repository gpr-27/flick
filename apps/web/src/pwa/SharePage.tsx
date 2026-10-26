import { useMemo } from 'react';
import { Share2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EmptyState, Button } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { conversationTitle } from '@/features/chat/conversationView';
import { sendMessage } from '@/features/chat/outbox/useOutboxStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { AskFlickAboutShared } from '@/features/ai/AskFlickAboutShared';
import { sharedTextFrom } from './shareText';

/** Where "Share" from another app lands (manifest share_target): pick a chat to send it to. */
export const SharePage = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const userId = useSessionStore((s) => s.user?.id);
  const conversations = useChatStore((s) => s.conversations);
  const text = useMemo(() => sharedTextFrom(search), [search]);
  const chats = Object.values(conversations);

  if (!text) {
    return (
      <EmptyState
        icon={<Share2 className="size-10" />}
        title="Nothing to share"
        description="Share text or a link to Flick from another app."
        action={{
          label: 'Go to chats',
          onClick: () => {
            navigate('/');
          },
        }}
      />
    );
  }

  const share = (conversationId: string): void => {
    if (!userId) return;
    sendMessage(userId, conversationId, { type: 'text', text });
    useChatStore.getState().select(conversationId);
    navigate('/');
  };

  return (
    <div className="mx-auto max-w-md p-4">
      <h1 className="font-display text-lg font-bold">Send to...</h1>
      <p className="mb-3 line-clamp-3 whitespace-pre-line text-sm text-base-content/70">{text}</p>
      <AskFlickAboutShared text={text} />
      <ul className="flex flex-col gap-1">
        {chats.map((c) => (
          <li key={c.id}>
            <Button
              variant="dashed"
              size="md"
              className="w-full justify-start"
              onClick={() => {
                share(c.id);
              }}
            >
              {conversationTitle(c)}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};
