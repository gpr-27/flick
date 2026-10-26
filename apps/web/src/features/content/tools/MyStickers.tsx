import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { notify } from '@/components/ui';
import { sendStickerBlob } from './sendStickerBlob';
import { deleteSticker, listStickers, type SavedSticker } from './stickers';

/** The "My stickers" tab: stickers saved on this device (IndexedDB). */
export const MyStickers = ({
  onPick,
}: {
  onPick: (c: Extract<MessageContent, { type: 'image' }>) => void;
}) => {
  const [items, setItems] = useState<{ s: SavedSticker; url: string }[] | null>(null);

  useEffect(() => {
    let urls: string[] = [];
    listStickers()
      .then((all) => {
        const mapped = all.map((s) => ({ s, url: URL.createObjectURL(s.blob) }));
        urls = mapped.map((m) => m.url);
        setItems(mapped);
      })
      .catch(() => {
        setItems([]);
      });
    return () => {
      urls.forEach((u) => {
        URL.revokeObjectURL(u);
      });
    };
  }, []);

  if (!items) return null;
  if (items.length === 0) {
    return (
      <p className="h-64 p-4 text-center text-sm text-base-content/70">
        No stickers yet. Use "Make a sticker" in the tools menu and save it.
      </p>
    );
  }
  return (
    <ul className="grid h-64 grid-cols-3 gap-2 overflow-y-auto">
      {items.map(({ s, url }) => (
        <li key={s.id} className="group relative">
          <button
            type="button"
            aria-label="Send sticker"
            className="block w-full"
            onClick={() => {
              void sendStickerBlob(s.blob, (c) => {
                onPick(c as Extract<MessageContent, { type: 'image' }>);
              }).catch(() => {
                notify.error("Couldn't send the sticker.");
              });
            }}
          >
            <img src={url} alt="" className="aspect-square w-full object-contain" />
          </button>
          <button
            type="button"
            aria-label="Delete sticker"
            className="absolute right-0 top-0 hidden rounded bg-base-100/80 p-1 group-hover:block"
            onClick={() => {
              void deleteSticker(s.id).then(() => {
                setItems((cur) => cur?.filter((i) => i.s.id !== s.id) ?? null);
              });
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
};
