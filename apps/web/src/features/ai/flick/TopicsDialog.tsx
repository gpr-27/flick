import { useState, type FormEvent } from 'react';
import { Pencil, Search, X } from 'lucide-react';
import type { MessageRecord } from '@chat/contracts';
import { Modal, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useJumpStore } from '@/features/organise/jump';
import { searchTopics, useFlickTopics } from './useFlickTopics';

/** All topics of the Flick chat: search, rename, jump to where one starts. */
export const TopicsDialog = ({
  open,
  onClose,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  /** The loaded messages of the Flick chat, to find where a topic starts. */
  messages: readonly MessageRecord[];
}) => {
  const topics = useFlickTopics((s) => s.topics);
  const rename = useFlickTopics((s) => s.rename);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const save = async (e: FormEvent, id: string): Promise<void> => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await rename(id, title.trim());
      setEditing(null);
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't rename the topic."));
    }
  };

  const shown = searchTopics(topics, query);
  return (
    <Modal open={open} onClose={onClose} labelledBy="topics-title" className="max-w-md p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="topics-title" className="font-display text-lg font-semibold">
          Topics
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <label className="relative mb-3 block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-base-content/50"
          aria-hidden="true"
        />
        <input
          className="input-soft min-h-[44px] w-full pl-9"
          placeholder="Search topics"
          aria-label="Search topics"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
      </label>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/60">
          {topics.length === 0
            ? 'No topics yet. Press "New topic" to start a fresh conversation.'
            : 'No topic matches.'}
        </p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {shown.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
              {editing === t.id ? (
                <form onSubmit={(e) => void save(e, t.id)} className="flex min-w-0 flex-1 gap-2">
                  <input
                    value={title}
                    maxLength={80}
                    autoFocus
                    aria-label="Topic title"
                    className="input-soft min-w-0 flex-1"
                    onChange={(e) => {
                      setTitle(e.target.value);
                    }}
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                    onClick={() => {
                      const first = messages.find((m) => m.seq >= t.started_message_seq);
                      if (first) useJumpStore.getState().jumpTo(first);
                      else notify.info('That topic has no messages yet.');
                      onClose();
                    }}
                  >
                    {t.title}
                    <span className="block text-xs font-normal text-base-content/50">
                      {new Date(t.created_at).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-circle"
                    aria-label={`Rename ${t.title}`}
                    onClick={() => {
                      setTitle(t.title);
                      setEditing(t.id);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
