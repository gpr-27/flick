import { useEffect, useMemo, useRef, useState } from 'react';
import { Crop, RotateCw } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { useBackClose } from '@/lib/useBackClose';
import { cropRect, editedFiles, renderEdit, sendAsFile, type CropMode } from './editPhoto';

const MODES: CropMode[] = ['free', '1:1', '4:3'];
const MODE_LABEL: Record<CropMode, string> = { free: 'Free', '1:1': '1:1', '4:3': '4:3' };

/**
 * Opens after a photo is picked: rotate, crop (original, square or 4:3), caption, and choose
 * between a compressed photo and the original file. Send hands the edited file back.
 */
export const PhotoEditor = ({
  file,
  onSend,
  onCancel,
}: {
  file: File;
  onSend: (file: File, caption: string) => void;
  onCancel: () => void;
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Keyboard users: focus stays inside, Escape cancels, focus returns to the composer.
  useFocusTrap(dialogRef, true, { onEscape: onCancel });
  useBackClose(true, onCancel);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const [turns, setTurns] = useState(0);
  const [mode, setMode] = useState<CropMode>('free');
  const [caption, setCaption] = useState('');
  const [asFile, setAsFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ w: 4, h: 3 });

  useEffect(
    () => () => {
      URL.revokeObjectURL(url);
    },
    [url],
  );

  // The preview shows the crop as a frame over the rotated image.
  const odd = turns % 2 !== 0;
  const box = cropRect(odd ? size.h : size.w, odd ? size.w : size.h, mode);
  const frameRatio = box.w / box.h;

  const send = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const edited =
        turns === 0 && mode === 'free' ? file : await renderEdit(file, { turns, mode });
      editedFiles.add(edited);
      if (asFile) sendAsFile.add(edited);
      onSend(edited, caption.trim());
    } catch {
      setError("Couldn't edit this photo. Try again.");
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Edit photo"
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 text-white"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          style={{ aspectRatio: frameRatio }}
          className="relative max-h-full max-w-full overflow-hidden rounded-lg"
        >
          <img
            src={url}
            alt="Photo preview"
            onLoad={(e) => {
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
            }}
            style={{ transform: `rotate(${turns * 90}deg)` }}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
          />
        </div>
      </div>
      <div className="mx-auto mt-3 flex w-full max-w-md flex-col gap-2">
        <div className="flex items-center justify-center gap-2">
          <Crop className="size-4" aria-hidden="true" />
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === mode}
              className={`btn btn-xs rounded-full ${m === mode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setMode(m);
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-xs btn-ghost rounded-full"
            aria-label="Rotate 90 degrees"
            onClick={() => {
              setTurns((t) => (t + 1) % 4);
            }}
          >
            <RotateCw className="size-4" aria-hidden="true" />
          </button>
        </div>
        <input
          className="input input-bordered w-full text-base-content"
          placeholder="Add a caption"
          aria-label="Caption"
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value);
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={asFile}
            onChange={(e) => {
              setAsFile(e.target.checked);
            }}
          />
          Send as file (original quality)
        </label>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
