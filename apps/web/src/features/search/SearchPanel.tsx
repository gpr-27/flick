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
import { MEDIA, filterParams, type SearchFilters } from './searchFilters';

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
  const [filters, setFilters] = useState<SearchFilters>({});
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
          ...filterParams(filters),
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
    setFilters({});
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

      <div
        className="mb-3 flex flex-wrap items-center gap-1 text-xs"
        aria-label="Filters"
        role="group"
      >
        {MEDIA.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={filters.media === m}
            className={`rounded-full px-3 py-1 font-semibold capitalize ${filters.media === m ? 'bg-primary text-primary-content' : 'bg-base-content/5'}`}
            onClick={() => {
              setFilters((f) => ({ ...f, media: f.media === m ? undefined : m }));
            }}
          >
            {m}
          </button>
        ))}
        {(['starred', 'pinned'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={Boolean(filters[k])}
            className={`rounded-full px-3 py-1 font-semibold capitalize ${filters[k] ? 'bg-primary text-primary-content' : 'bg-base-content/5'}`}
            onClick={() => {
              setFilters((f) => ({ ...f, [k]: !f[k] }));
            }}
          >
            {k}
          </button>
        ))}
        <select
          aria-label="From person"
          className="select select-xs"
          value={filters.sender ?? ''}
          onChange={(e) => {
            setFilters((f) => ({ ...f, sender: e.target.value || undefined }));
          }}
        >
          <option value="">Anyone</option>
          {Object.keys(users).map((id) => (
            <option key={id} value={id}>
              {userName(users, id)}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From date"
          className="input input-xs"
          value={filters.from ?? ''}
          onChange={(e) => {
            setFilters((f) => ({ ...f, from: e.target.value || undefined }));
          }}
        />
        <input
          type="date"
          aria-label="To date"
          className="input input-xs"
          value={filters.to ?? ''}
          onChange={(e) => {
            setFilters((f) => ({ ...f, to: e.target.value || undefined }));
          }}
        />
      </div>

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
