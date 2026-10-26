import { useEffect, useRef, useState } from 'react';
import type { MessageContent } from '@chat/contracts';
import { Modal, notify } from '@/components/ui';
import { makeSticker, saveSticker } from './stickers';
import { sendStickerBlob } from './sendStickerBlob';

/** Pick a photo, get a rounded square sticker; send it or keep it in "My stickers". */
export const StickerDialog = ({
  onSend,
  onClose,
}: {
  onSend: (c: MessageContent) => void;
  onClose: () => void;
}) => {
  const [sticker, setSticker] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const showSticker = (blob: Blob): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setSticker({ blob, url });
  };

  return (
    <Modal open onClose={onClose} label="Sticker maker" className="w-80 p-4 text-center">
      <h2 className="mb-2 font-semibold">Make a sticker</h2>
      <input
        type="file"
        accept="image/*"
        aria-label="Choose a photo"
        className="file-input file-input-sm w-full"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            makeSticker(f)
              .then(showSticker)
              .catch(() => {
                notify.error("Couldn't read that photo.");
              });
        }}
      />
      {sticker && (
        <img
          src={sticker.url}
          alt="Sticker preview"
          className="mx-auto mt-3 size-40 object-contain"
        />
      )}
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!sticker}
          onClick={() => {
            if (sticker)
              void saveSticker(sticker.blob).then(() => {
                notify.success('Saved to My stickers');
              });
          }}
        >
          Save to my stickers
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!sticker || busy}
          onClick={() => {
            if (!sticker) return;
            setBusy(true);
            sendStickerBlob(sticker.blob, onSend)
              .then(onClose)
              .catch(() => {
                notify.error("Couldn't send the sticker.");
                setBusy(false);
              });
          }}
        >
          Send
        </button>
      </div>
    </Modal>
  );
};
