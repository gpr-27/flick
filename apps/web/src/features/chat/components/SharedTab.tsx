import { useCallback, useEffect, useState } from 'react';
import { ENDPOINTS, type MessageRecord, type SharedKind } from '@chat/contracts';
import type { z } from 'zod';
import { Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { firstUrl } from '@/features/content/urls';
import { getAttachmentUrl } from '../content/attachments';
import { renderContent } from '../content/registry';

type Kind = z.infer<typeof SharedKind>;

const TABS: { id: Kind; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'links', label: 'Links' },
  { id: 'files', label: 'Docs' },
  { id: 'voice', label: 'Voice' },
];
const EMPTY: Record<Kind, string> = {
  media: 'No photos or videos yet.',
  links: 'No links yet.',
  files: 'No documents yet.',
  voice: 'No voice messages yet.',
};

const openImage = (attachmentId: string): void => {
  void getAttachmentUrl(attachmentId).then((url) => window.open(url, '_blank', 'noopener'));
};

/** The link a text message holds, shown as a clickable row. */
const LinkRow = ({ message }: { message: MessageRecord }) => {
  const text = message.content?.type === 'text' ? message.content.text : '';
  const url = firstUrl(text);
  if (!url) return null;
  return (
    <li className="rounded-xl bg-base-content/5 p-3 text-sm">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block truncate font-semibold text-primary underline"
      >
        {url}
      </a>
      <span className="text-xs text-base-content/60">
        {new Date(message.created_at).toLocaleDateString()}
      </span>
    </li>
  );
};

/** One tab's list, newest first, loaded a page at a time. Mounted per kind, so it starts fresh. */
const SharedList = ({ conversationId, kind }: { conversationId: string; kind: Kind }) => {
  const [items, setItems] = useState<MessageRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const fetchPage = useCallback(
    (after?: string) =>
      getApi().call(ENDPOINTS.conversations.shared, {
        params: { conversation_id: conversationId },
        query: { kind, limit: 30, ...(after ? { before_seq: Number(after) } : {}) },
      }),
    [conversationId, kind],
  );
  const fail = (e: unknown): void => {
    setError(getErrorMessage(e, "Couldn't load this list."));
    setStatus('error');
  };

  useEffect(() => {
    let alive = true;
    fetchPage()
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (alive) fail(e);
      });
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  const loadMore = (after: string): void => {
    setStatus('loading');
    fetchPage(after)
      .then((page) => {
        setItems((old) => [...old, ...page.items]);
        setCursor(page.next_cursor);
        setStatus('ready');
      })
      .catch(fail);
  };

  return (
    <div>
      {status === 'error' && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {status === 'ready' && items.length === 0 && (
        <p className="py-6 text-center text-sm text-base-content/60">{EMPTY[kind]}</p>
      )}
      {items.length > 0 && (
        <ul className={kind === 'media' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
          {items.map((m) =>
            kind === 'links' ? (
              <LinkRow key={m.message_id} message={m} />
            ) : (
              <li key={m.message_id} className="min-w-0">
                {m.content && renderContent(m.content, { onOpenImage: openImage })}
              </li>
            ),
          )}
        </ul>
      )}
      {status === 'loading' && <Spinner size="sm" label="Loading" />}
      {status === 'ready' && cursor && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-2 w-full"
          onClick={() => {
            loadMore(cursor);
          }}
        >
          Load more
        </button>
      )}
    </div>
  );
};

/** "Media, links and files" of one chat. */
export const SharedTab = ({ conversationId }: { conversationId: string }) => {
  const [kind, setKind] = useState<Kind>('media');
  return (
    <div>
      <div role="tablist" aria-label="Shared in this chat" className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === kind}
            className={`btn btn-sm rounded-full ${t.id === kind ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setKind(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SharedList key={kind} conversationId={conversationId} kind={kind} />
    </div>
  );
};
