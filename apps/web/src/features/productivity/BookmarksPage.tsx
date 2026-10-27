import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useEffect, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ENDPOINTS } from '@chat/contracts';
import { EmptyState, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useCollections } from './useCollections';

type Item = {
  message_id: string;
  collection_id: string;
  conversation_id: string;
  text: string;
  created_at: string;
};

/** /bookmarks: saved messages grouped in named collections. */
const BookmarksPage = () => {
  const { items: collections, reload } = useCollections();
  const [active, setActive] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    getApi()
      .call(ENDPOINTS.productivity.bookmarks, {
        query: active ? { collection_id: active } : {},
      })
      .then((res) => {
        setItems(res.items);
      })
      .catch((e: unknown) => {
        notify.error(getErrorMessage(e, "Couldn't load your bookmarks."));
      });
  }, [active]);

  const remove = async (i: Item): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.productivity.removeBookmark, {
        params: { collection_id: i.collection_id, message_id: i.message_id },
      });
      setItems((cur) => cur.filter((x) => x !== i));
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't remove the bookmark."));
    }
  };

  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      className={`btn btn-sm ${active === id ? 'btn-primary' : 'btn-ghost'}`}
      onClick={() => {
        setActive(id);
      }}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Bookmarks</h1>
        <Link to="/" className="btn btn-ghost btn-sm">
          Back to chats
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {chip(null, 'All')}
        {collections.map((c) => chip(c.id, c.name))}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Bookmark />}
          title="Nothing bookmarked yet"
          description="Use Bookmark… in a message's menu."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={`${i.collection_id}:${i.message_id}`}
              className="glass-card flex items-start gap-2 rounded-2xl p-3"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  navigate(`/?c=${i.conversation_id}`);
                }}
              >
                <p className="line-clamp-3 text-sm">{stripMarkdown(i.text)}</p>
                <p className="mt-1 text-xs text-base-content/60">
                  {collections.find((c) => c.id === i.collection_id)?.name} ·{' '}
                  {new Date(i.created_at).toLocaleDateString()}
                </p>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-sm"
                aria-label="Remove bookmark"
                onClick={() => void remove(i)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default BookmarksPage;
