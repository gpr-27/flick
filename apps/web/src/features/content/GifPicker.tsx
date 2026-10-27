import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { ENDPOINTS, type GifResult, type MessageContent } from '@chat/contracts';
import { Spinner, cn, useFocusTrap } from '@/components/ui';
import { useBackClose } from '@/lib/useBackClose';
import { getApi } from '@/lib/services';
import { gifErrorMessage } from './gifErrors';
import { MyStickers } from './tools/MyStickers';

type Kind = 'gif' | 'sticker' | 'mine';
type Item = z.infer<typeof GifResult>;
type Picked = Extract<MessageContent, { type: 'gif' | 'sticker' | 'image' }>;

const SEARCH_DELAY_MS = 400;

/** A result belongs to the request `key` it answered; a different current key means "loading". */
interface Loaded {
  key: string;
  error: string | null;
  items: Item[];
}

export const GifPicker = ({
  onPick,
  onClose,
}: {
  onPick: (content: Picked) => void;
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, { onEscape: onClose });
  useBackClose(true, onClose);
  const [kind, setKind] = useState<Kind>('gif');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${kind}:${search}`;

  // Wait for a pause in typing so each keystroke does not cost a rate-limited server call.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (kind === 'mine') return;
    let alive = true;
    const request = search
      ? getApi().call(ENDPOINTS.media.gifSearch, { query: { kind, q: search } })
      : getApi().call(ENDPOINTS.media.gifTrending, { query: { kind } });
    request
      .then((res) => {
        if (alive) setLoaded({ key, error: null, items: res.items });
      })
      .catch((error: unknown) => {
        if (alive) setLoaded({ key, error: gifErrorMessage(error), items: [] });
      });
    return () => {
      alive = false;
    };
  }, [kind, search, key]);

  const current = loaded?.key === key ? loaded : null;

  const pick = (item: Item): void => {
    onPick(
      kind === 'gif'
        ? { type: 'gif', gif_id: item.id, url: item.url, width: item.width, height: item.height }
        : { type: 'sticker', sticker_id: item.id, url: item.url },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-10" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label="GIF and sticker picker"
        className="glass-card absolute bottom-full left-3 z-20 mb-2 w-80 rounded-2xl border border-base-content/10 p-3 shadow-xl"
      >
        <div className="mb-2 flex gap-2">
          {(['gif', 'sticker', 'mine'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
              }}
              className={cn('btn btn-sm', kind === k ? 'btn-primary' : 'btn-ghost')}
            >
              {k === 'gif' ? 'GIFs' : k === 'sticker' ? 'Stickers' : 'My stickers'}
            </button>
          ))}
        </div>
        {kind === 'mine' && <MyStickers onPick={onPick} />}
        <label htmlFor="gif-search" className="sr-only">
          Search {kind === 'gif' ? 'GIFs' : 'stickers'}
        </label>
        <input
          id="gif-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search…"
          autoComplete="off"
          className={cn('input-soft mb-2 w-full', kind === 'mine' && 'hidden')}
        />
        <div className={cn('h-64 overflow-y-auto', kind === 'mine' && 'hidden')} aria-live="polite">
          {!current && (
            <div className="grid h-full place-items-center">
              <Spinner size="sm" label="Loading" />
            </div>
          )}
          {current?.error && (
            <p role="alert" className="p-4 text-center text-sm text-base-content/70">
              {current.error}
            </p>
          )}
          {current && !current.error && current.items.length === 0 && (
            <p className="p-4 text-center text-sm text-base-content/70">Nothing found.</p>
          )}
          {current && !current.error && current.items.length > 0 && (
            <ul className="grid grid-cols-2 gap-2">
              {current.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      pick(item);
                    }}
                    aria-label={`Send ${item.title || (kind === 'gif' ? 'GIF' : 'sticker')}`}
                    className="block w-full overflow-hidden rounded-lg bg-base-content/5 focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <img
                      src={item.preview_url}
                      alt={item.title}
                      loading="lazy"
                      className="h-24 w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};
