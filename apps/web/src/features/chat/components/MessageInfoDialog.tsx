import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ENDPOINTS, type MessageInfo } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, ErrorState, Modal, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useChatStore } from '../useChatStore';

type Recipient = z.infer<typeof MessageInfo>['recipients'][number];

interface Person {
  name: string;
  avatar: string | null;
}

const List = ({ title, people }: { title: string; people: Person[] }) => (
  <section aria-label={title} className="mt-4">
    <h3 className="mb-1 text-sm font-semibold text-base-content/60">{title}</h3>
    {people.length === 0 ? (
      <p className="px-2 py-1 text-sm text-base-content/60">Nobody yet</p>
    ) : (
      <ul>
        {people.map((p, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl p-2">
            <Avatar src={p.avatar} name="" size="xs" />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

/**
 * "Message info" for one of my own messages: who it reached and who read it.
 * The API reports a yes/no per person, not a time, so no times are shown.
 */
export const MessageInfoDialog = ({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string;
  messageId: string;
  onClose: () => void;
}) => {
  const members = useChatStore((s) => s.members[conversationId]);
  const peer = useChatStore((s) => s.conversations[conversationId]?.peer);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.messages.info, {
        params: { conversation_id: conversationId, message_id: messageId },
      })
      .then(
        (info) => {
          if (!cancelled) setRecipients(info.recipients);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load message info."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId, attempt]);

  useEffect(() => {
    void useChatStore.getState().loadMembers(conversationId);
  }, [conversationId]);

  const person = (userId: string): Person => {
    const user =
      members?.find((m) => m.user.id === userId)?.user ?? (peer?.id === userId ? peer : null);
    return { name: user?.display_name ?? 'Someone', avatar: user?.avatar_url ?? null };
  };
  const read = (recipients ?? []).filter((r) => r.read).map((r) => person(r.user_id));
  const delivered = (recipients ?? [])
    .filter((r) => r.delivered && !r.read)
    .map((r) => person(r.user_id));

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="message-info-title"
      className="glass-card scroll-slim mx-4 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 animate-scale-in"
    >
      <div className="flex items-center justify-between">
        <h2 id="message-info-title" className="font-display text-xl font-bold">
          Message info
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm min-h-[44px] min-w-[44px]"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !recipients ? (
        <div className="grid place-items-center py-10">
          <Spinner size="lg" label="Loading message info" />
        </div>
      ) : recipients.length === 0 ? (
        <p className="py-8 text-center text-sm text-base-content/60">
          Nobody else is in this chat.
        </p>
      ) : (
        <>
          <List title="Read by" people={read} />
          <List title="Delivered to" people={delivered} />
        </>
      )}
    </Modal>
  );
};
