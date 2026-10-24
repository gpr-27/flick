import { useRef, useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import type { z } from 'zod';
import type { SearchHit as SearchHitSchema } from '@chat/contracts';
import { EmptyState, Modal, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { formatRelativeTime } from '@/lib/time';
import { conversationTitle } from '../chat/conversationView';
import { useChatStore, userName } from '../chat/useChatStore';
import { useJumpStore } from '../organise/jump';
import { useLockStore } from '../organise/lock';
import { Snippet } from './Snippet';

type Hit = z.infer<typeof SearchHitSchema>;

/**
 * Message search over all of the caller's chats, or one chat when `conversationId` is given.
 * The query is sent when the form is submitted (Enter or the Search button).
 */
export const SearchPanel = ({
  open,
  onClose,
  conversationId,
}: {
  open: boolean;
  onClose: () => void;
  conversationId?: string;
}) => {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);
  const unlocked = useLockStore((s) => s.unlocked);

  const run = async (q: string, after?: string): Promise<void> => {
    setStatus('loading');
    try {
      const page = await getApi().call(ENDPOINTS.messages.search, {
        query: {
          q,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          ...(after ? { cursor: after } : {}),
        },
      });
      setHits((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setSearched(q);
      setStatus('ready');
    } catch (e) {
      setError(getErrorMessage(e, 'Search failed.'));
      setStatus('error');
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const q = query.trim();
    if (q) void run(q);
  };

  const close = (): void => {
    setQuery('');
    setSearched('');
    setHits([]);
    setCursor(null);
    setStatus('idle');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy="search-title"
      initialFocusRef={inputRef}
      className="glass-card mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="search-title" className="font-display text-xl font-bold">
          {conversationId ? 'Search in chat' : 'Search messages'}
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

      <form onSubmit={submit} role="search" className="mb-3 flex gap-2">
        <label htmlFor="message-search" className="sr-only">
          Search messages
        </label>
        <input
          id="message-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search messages"
          maxLength={200}
          className="input-soft flex-1"
        />
        <button type="submit" className="btn btn-primary" disabled={!query.trim()}>
          <Search className="size-4" aria-hidden="true" />
          Search
        </button>
      </form>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {status === 'error' && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {status === 'ready' && hits.length === 0 && (
          <EmptyState
            icon={<Search className="size-8" />}
            title="No messages found"
            description={`Nothing matches "${searched}".`}
          />
        )}
        {hits.length > 0 && (
          <ul aria-label="Search results" className="space-y-1">
            {hits.map(({ message, snippet }) => {
              const conv = conversations[message.conversation_id];
              // A locked chat's text stays hidden here until its passcode is entered.
              const hidden = Boolean(conv?.prefs.locked) && !unlocked[message.conversation_id];
              return (
                <li key={message.message_id}>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2 text-left hover:bg-base-content/5 focus-visible:bg-base-content/5"
                    onClick={() => {
                      close();
                      useJumpStore.getState().jumpTo(message);
                    }}
                  >
                    <span className="block text-xs text-base-content/60">
                      {conv ? conversationTitle(conv) : 'Chat'} ·{' '}
                      {userName(users, message.sender_user_id)} ·{' '}
                      {formatRelativeTime(message.created_at)}
                    </span>
                    <span className="block break-words text-sm">
                      {hidden ? <em>Locked chat</em> : <Snippet snippet={snippet} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {status === 'loading' && (
          <div className="flex justify-center py-4">
            <Spinner size="sm" label="Searching" />
          </div>
        )}
        {status === 'ready' && cursor && (
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2 w-full"
            onClick={() => {
              void run(searched, cursor);
            }}
          >
            Load more
          </button>
        )}
      </div>
    </Modal>
  );
};
