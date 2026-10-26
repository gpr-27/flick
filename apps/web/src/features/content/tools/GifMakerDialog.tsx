import { useEffect, useRef, useState } from 'react';
import type { MessageContent } from '@chat/contracts';
import { Modal, notify } from '@/components/ui';
import { uploadAttachment } from '@/features/chat/upload';
import { encodeGif } from './gifEncoder';

const FPS = 10;
const WIDTH = 240;

const seek = (v: HTMLVideoElement, t: number): Promise<void> =>
  new Promise((resolve) => {
    v.onseeked = () => {
      resolve();
    };
    v.currentTime = t;
  });

/** Turn up to 5 seconds of a video into a looping GIF (frames drawn on a canvas, pure-JS encoder). */
export const GifMakerDialog = ({
  onSend,
  onClose,
}: {
  onSend: (c: MessageContent) => void;
  onClose: () => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [seconds, setSeconds] = useState(3);
  const [duration, setDuration] = useState(0);
  const [gif, setGif] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src],
  );
  useEffect(
    () => () => {
      if (gif) URL.revokeObjectURL(gif.url);
    },
    [gif],
  );

  const make = async (): Promise<void> => {
    const v = video.current;
    if (!v) return;
    setBusy(true);
    try {
      const w = WIDTH;
      const h = Math.max(2, Math.round((WIDTH * v.videoHeight) / v.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no canvas');
      const frames: Uint8ClampedArray[] = [];
      const count = Math.round(seconds * FPS);
      for (let i = 0; i < count; i++) {
        await seek(v, Math.min(start + i / FPS, Math.max(0, duration - 0.05)));
        ctx.drawImage(v, 0, 0, w, h);
        frames.push(ctx.getImageData(0, 0, w, h).data);
      }
      const bytes = encodeGif(frames, w, h, 1000 / FPS);
      const blob = new Blob([bytes as BlobPart], { type: 'image/gif' });
      setGif({ blob, url: URL.createObjectURL(blob), w, h });
    } catch {
      notify.error("Couldn't make the GIF.");
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    if (!gif) return;
    setBusy(true);
    try {
      const id = await uploadAttachment(gif.blob, {
        purpose: 'message',
        mime: 'image/gif',
        fileName: 'clip.gif',
      });
      onSend({ type: 'image', attachment_id: id, width: gif.w, height: gif.h });
      onClose();
    } catch {
      notify.error("Couldn't send the GIF.");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} label="GIF maker" className="w-96 max-w-full p-4">
      <h2 className="mb-2 font-semibold">Make a GIF from a video</h2>
      <input
        type="file"
        accept="video/*"
        aria-label="Choose a video"
        className="file-input file-input-sm w-full"
        onChange={(e) => {
          const f = e.target.files?.[0];
          setGif(null);
          if (f) setSrc(URL.createObjectURL(f));
        }}
      />
      {src && (
        <>
          <video
            ref={video}
            src={src}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
            }}
            className="mt-3 max-h-48 w-full rounded-lg bg-black"
          />
          <label className="mt-2 block text-sm">
            Start at {start.toFixed(1)} s
            <input
              type="range"
              min={0}
              max={Math.max(0, duration - 0.5)}
              step={0.1}
              value={start}
              onChange={(e) => {
                setStart(Number(e.target.value));
              }}
              className="range range-xs w-full"
            />
          </label>
          <label className="mt-1 block text-sm">
            Length {seconds} s (up to 5)
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={seconds}
              onChange={(e) => {
                setSeconds(Number(e.target.value));
              }}
              className="range range-xs w-full"
            />
          </label>
        </>
      )}
      {gif && <img src={gif.url} alt="GIF preview" className="mx-auto mt-3 max-h-40 rounded-lg" />}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!src || busy}
          onClick={() => void make()}
        >
          {busy && !gif ? 'Working…' : 'Make GIF'}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!gif || busy}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </Modal>
  );
};
