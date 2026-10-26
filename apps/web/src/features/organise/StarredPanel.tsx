import { Fragment, useCallback, useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import { ENDPOINTS, type MessageRecord } from '@chat/contracts';
import { EmptyState, ErrorState, Modal, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { getApi } from '@/lib/services';
import { previewContent } from '../chat/content/registry';
import { conversationTitle } from '../chat/conversationView';
import { useChatStore, userName } from '../chat/useChatStore';
import { useJumpStore } from './jump';
import { toggleStar } from './messageActions';
import { groupStarred } from './groupStarred';

const StarredBody = ({ onClose }: { onClose: () => void }) => {
  const [items, setItems] = useState<MessageRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);

  const fetchPage = useCallback((after?: string) => {
    getApi()
      .call(ENDPOINTS.messages.starred, { query: after ? { cursor: after } : {} })
      .then((page) => {
        setItems((old) => (after ? [...old, ...page.items] : page.items));
        setCursor(page.next_cursor);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        setError(getErrorMessage(e, "Couldn't load starred messages."));
        setStatus('error');
      });
  }, []);

  // Button handlers show the spinner first; the first load starts in "loading" already.
  const load = (after?: string): void => {
    setStatus('loading');
    fetchPage(after);
  };

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const shown = groupStarred(
    items,
    (id) => (conversations[id] ? conversationTitle(conversations[id]) : ''),
    (m) => previewContent(m.content),
    filter,
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="starred-title" className="font-display text-xl font-bold">
          Starred messages
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <input
        type="search"
        aria-label="Search starred messages"
        placeholder="Search starred"
        className="input-soft mb-3"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
      />
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {status === 'error' && items.length === 0 ? (
          <ErrorState
            title="Couldn't load"
            message={error}
            onRetry={() => {
              load();
            }}
          />
        ) : items.length === 0 && status === 'ready' ? (
          <EmptyState
            icon={<Star className="size-8" />}
            title="No starred messages"
            description="Star a message to find it here."
          />
        ) : (
          <ul className="space-y-1">
            {shown.map((m, i) => {
              const conv = conversations[m.conversation_id];
              const newGroup = shown[i - 1]?.conversation_id !== m.conversation_id;
              return (
                <Fragment key={m.message_id}>
                  {newGroup && (
                    <li className="px-3 pt-2 text-xs font-semibold uppercase text-base-content/50">
                      {conv ? conversationTitle(conv) : 'Chat'}
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left hover:bg-base-content/5 focus-visible:bg-base-content/5"
                      onClick={() => {
                        onClose();
                        useJumpStore.getState().jumpTo(m);
                      }}
                    >
                      <span className="block text-xs text-base-content/60">
                        {userName(users, m.sender_user_id)} · {formatRelativeTime(m.created_at)}
                      </span>
                      <span className="block truncate">{previewContent(m.content)}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs mt-2"
                      aria-label={`Unstar: ${previewContent(m.content)}`}
                      onClick={() => {
                        void toggleStar(m).then(() => {
                          setItems((old) => old.filter((x) => x.message_id !== m.message_id));
                        });
                      }}
                    >
                      Unstar
                    </button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
        {status === 'loading' && (
          <div className="flex justify-center py-4">
            <Spinner size="sm" label="Loading starred messages" />
          </div>
        )}
        {status === 'ready' && cursor && (
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2 w-full"
            onClick={() => {
              load(cursor);
            }}
          >
            Load more
          </button>
        )}
      </div>
    </>
  );
};

/** Everything the caller starred, newest first. Activating one opens it in its chat. */
export const StarredPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <Modal
    open={open}
    onClose={onClose}
    labelledBy="starred-title"
    className="glass-card mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-3xl p-6 animate-scale-in"
  >
    <StarredBody onClose={onClose} />
  </Modal>
);
