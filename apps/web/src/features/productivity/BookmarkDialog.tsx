import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useCollections } from './useCollections';

/** "Bookmark…": pick a named collection (Work, Ideas, Links or your own) for a message. */
export const BookmarkDialog = ({
  messageId,
  onClose,
}: {
  messageId: string;
  onClose: () => void;
}) => {
  const { items, reload } = useCollections();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (collectionId: string): Promise<void> => {
    setBusy(true);
    try {
      await getApi().call(ENDPOINTS.productivity.addBookmark, {
        body: { message_id: messageId, collection_id: collectionId },
      });
      notify.success('Bookmarked');
      onClose();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't bookmark this message."));
      setBusy(false);
    }
  };

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await getApi().call(ENDPOINTS.productivity.createCollection, {
        body: { name: name.trim() },
      });
      await save(c.id);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't create the collection."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="bookmark-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="bookmark-title" className="font-display text-xl font-bold">
          Bookmark to…
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
      <div className="flex flex-col gap-2">
        {items.map((c) => (
          <Button key={c.id} variant="secondary" disabled={busy} onClick={() => void save(c.id)}>
            {c.name}
          </Button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          className="input-soft min-w-0 flex-1 max-sm:text-base"
          placeholder="New collection"
          maxLength={40}
          value={name}
          aria-label="New collection name"
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !name.trim()}
          icon={<Plus className="size-4" />}
        >
          Add
        </Button>
      </form>
    </Modal>
  );
};
