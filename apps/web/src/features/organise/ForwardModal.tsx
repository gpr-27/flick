import { useState } from 'react';
import { X } from 'lucide-react';
import type { MessageRecord } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { previewContent } from '../chat/content/registry';
import { conversationTitle } from '../chat/conversationView';
import { sortConversations } from '../chat/threadOps';
import { useChatStore } from '../chat/useChatStore';
import { forwardContent, forwardMessage } from './messageActions';

/** Pick one or more chats and send a copy of the message to each, marked "Forwarded". */
export const ForwardModal = ({
  message,
  onClose,
}: {
  message: MessageRecord | null;
  onClose: () => void;
}) => {
  const conversations = useChatStore((s) => s.conversations);
  const myId = useSessionStore((s) => s.user?.id);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const chats = sortConversations(Object.values(conversations)).filter((c) =>
    conversationTitle(c).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const close = (): void => {
    setPicked([]);
    setQuery('');
    onClose();
  };

  const send = (): void => {
    if (!message || !myId) return;
    if (forwardMessage(myId, message, picked)) {
      notify.success(picked.length === 1 ? 'Message forwarded.' : 'Messages forwarded.');
      close();
    } else {
      notify.error("This kind of message can't be forwarded.");
    }
  };

  const toggle = (id: string): void => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  return (
    <Modal
      open={message !== null}
      onClose={close}
      labelledBy="forward-title"
      className="glass-card mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="forward-title" className="font-display text-xl font-bold">
          Forward message
        </h2>
        <button
          type="button"
          onClick={close}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      {message && (
        <p className="mb-3 truncate rounded-xl bg-base-content/5 px-3 py-2 text-sm">
          {forwardContent(message.content)
            ? previewContent(message.content)
            : "This kind of message can't be forwarded."}
        </p>
      )}
      <label htmlFor="forward-filter" className="sr-only">
        Search chats
      </label>
      <input
        id="forward-filter"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        placeholder="Search chats"
        className="input-soft mb-3 w-full"
      />
      <ul className="scroll-slim min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Chats">
        {chats.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-base-content/5">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={picked.includes(c.id)}
                onChange={() => {
                  toggle(c.id);
                }}
              />
              <span className="truncate">{conversationTitle(c)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={picked.length === 0}
          onClick={send}
        >
          Send{picked.length > 0 ? ` (${picked.length})` : ''}
        </button>
      </div>
    </Modal>
  );
};
