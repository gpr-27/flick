// The media tray above the message box: thumbnails of the picked photos and videos with their
// upload state, one caption for the whole album, and Send.
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Check, Clock, File as FileIcon, ImageOff, Play, Plus, Send, X } from 'lucide-react';
import { LIMITS } from '@chat/contracts';
import { cn } from '@/components/ui';
import { ProgressRing } from '../components/ProgressRing';
import type { AlbumDraft, DraftItem } from './useAlbumDraft';
import { mediaFilesFromClipboard } from './pickedFiles';
import { createThumbnail, formatDuration, type Thumbnail } from './thumbnails';

const statusText = (item: DraftItem): string => {
  switch (item.status) {
    case 'waiting':
      return 'waiting to upload';
    case 'uploading':
      return `uploading ${String(Math.round(item.progress * 100))} percent`;
    case 'ready':
      return 'ready';
    case 'sent':
      return 'sent';
    case 'failed':
      return `failed. ${item.error ?? ''}`;
  }
};

/** Makes the thumbnail only once the tile is on screen, and frees it when the tile goes away. */
const useThumbnail = (
  file: File,
  kind: 'image' | 'video' | 'file',
): { ref: React.RefObject<HTMLLIElement>; thumb: Thumbnail | null; broken: boolean } => {
  const ref = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined', // no observer: make it now
  );
  const [thumb, setThumb] = useState<Thumbnail | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || kind === 'file') return;
    let alive = true;
    let made: Thumbnail | null = null;
    createThumbnail(file, kind)
      .then((t) => {
        if (alive) {
          made = t;
          setThumb(t);
        } else {
          URL.revokeObjectURL(t.url);
        }
      })
      .catch(() => {
        if (alive) setBroken(true);
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made.url);
    };
  }, [visible, file, kind]);

  return { ref, thumb, broken };
};

const Tile = ({
  item,
  onRemove,
  onRetry,
}: {
  item: DraftItem;
  onRemove: () => void;
  onRetry: () => void;
}) => {
  const { ref, thumb, broken } = useThumbnail(item.file, item.baseKind);
  const media = item.baseKind !== 'file';
  return (
    <li
      ref={ref}
      aria-label={`${item.fileName}, ${statusText(item)}`}
      className="relative size-[72px] shrink-0 overflow-hidden rounded-[var(--r-md)] bg-[var(--bg-sunken)] ring-1 ring-[var(--border)]"
    >
      {thumb ? (
        <img src={thumb.url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center p-1 text-[var(--text-2)]">
          {media && !broken ? (
            <span className="size-full animate-pulse rounded-[var(--r-sm)] bg-[var(--bg-hover)]" />
          ) : (
            <span className="flex flex-col items-center gap-0.5">
              <FileIcon className="size-6" aria-hidden="true" />
              <span className="line-clamp-1 max-w-full text-[10px] [overflow-wrap:anywhere]">
                {item.fileName}
              </span>
            </span>
          )}
        </span>
      )}
      {item.baseKind === 'video' && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Play className="size-2.5 fill-current" aria-hidden="true" />
          {thumb?.durationMs ? formatDuration(thumb.durationMs) : null}
        </span>
      )}
      {item.status === 'waiting' && (
        <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-black/60 text-white">
          <Clock className="size-3" aria-hidden="true" />
        </span>
      )}
      {item.status === 'uploading' && (
        <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
          <ProgressRing fraction={item.progress} size={32} />
        </span>
      )}
      {(item.status === 'ready' || item.status === 'sent') && (
        <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-success text-success-content">
          <Check className="size-3" aria-hidden="true" />
        </span>
      )}
      {item.status === 'failed' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-error/85 text-error-content">
          <ImageOff className="size-4" aria-hidden="true" />
          <button
            type="button"
            onClick={onRetry}
            className="tap-target rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-black"
            aria-label={`Retry ${item.fileName}`}
          >
            Retry
          </button>
        </span>
      )}
      {item.status !== 'sent' && (
        <button
          type="button"
          onClick={onRemove}
          className="tap-target absolute right-0.5 top-0.5 grid size-6 place-items-center rounded-full bg-black/65 text-white hover:bg-error"
          aria-label={`Remove ${item.fileName}`}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  );
};

export interface AlbumTrayProps {
  draft: AlbumDraft;
  caption: string;
  onCaptionChange: (value: string) => void;
  onSubmit: () => void;
  /** Opens the file picker. */
  onAddMore: () => void;
  /** Photos pasted into the caption box. */
  onFiles: (files: File[]) => void;
}

export const AlbumTray = ({
  draft,
  caption,
  onCaptionChange,
  onSubmit,
  onAddMore,
  onFiles,
}: AlbumTrayProps) => {
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const { items } = draft;
  const count = items.filter((i) => i.status !== 'sent').length;
  const full = count >= LIMITS.MAX_ALBUM_ITEMS;

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  const askToLeave = (): void => {
    if (draft.uploadsInProgress > 0) setConfirming(true);
    else draft.discard();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (confirming) setConfirming(false);
    else askToLeave();
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (draft.canSend) onSubmit();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = mediaFilesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    onFiles(files);
  };

  const onCaptionKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (draft.canSend) onSubmit();
    }
  };

  return (
    <section
      role="group"
      aria-label={`Photos and videos to send, ${String(count)} of ${String(LIMITS.MAX_ALBUM_ITEMS)}`}
      onKeyDown={onKeyDown}
      className="mb-2 rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-raised)] p-2 shadow-[var(--shadow-1)]"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <p className="text-sm font-semibold tabular-nums">
          <span aria-hidden="true">
            {count}/{LIMITS.MAX_ALBUM_ITEMS}
          </span>
          <span className="sr-only">
            {count} of {LIMITS.MAX_ALBUM_ITEMS} photos and videos
          </span>
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={draft.asFiles}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              draft.setAsFiles(e.target.checked);
            }}
          />
          Send as files (original quality)
        </label>
        <button
          type="button"
          onClick={askToLeave}
          className="btn btn-circle btn-ghost btn-sm size-11 min-h-11 sm:size-8 sm:min-h-8"
          aria-label="Cancel and remove all"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-label="Cancel uploads?"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--r-md)] bg-[var(--bg-active)] px-3 py-2 text-sm"
        >
          <span className="flex-1">
            {draft.uploadsInProgress === 1
              ? '1 upload is still running. Discard it?'
              : `${String(draft.uploadsInProgress)} uploads are still running. Discard them?`}
          </span>
          <button
            ref={keepRef}
            type="button"
            className="btn btn-sm min-h-11 sm:min-h-8"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep uploading
          </button>
          <button
            type="button"
            className="btn btn-error btn-sm min-h-11 sm:min-h-8"
            onClick={() => {
              setConfirming(false);
              draft.discard();
            }}
          >
            Discard
          </button>
        </div>
      )}

      <ul
        aria-label="Selected files"
        className="scroll-slim mb-2 flex gap-2 overflow-x-auto px-1 pb-1 pt-1"
      >
        {items.map((item) => (
          <Tile
            key={item.id}
            item={item}
            onRemove={() => {
              draft.remove(item.id);
            }}
            onRetry={() => {
              draft.retry(item.id);
            }}
          />
        ))}
        <li className="shrink-0">
          <button
            type="button"
            onClick={onAddMore}
            disabled={full}
            title={full ? `Up to ${String(LIMITS.MAX_ALBUM_ITEMS)} at once` : undefined}
            className={cn(
              'flex size-[72px] flex-col items-center justify-center gap-0.5 rounded-[var(--r-md)] border border-dashed border-[var(--border-strong)] text-xs font-semibold text-[var(--text-2)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <Plus className="size-5" aria-hidden="true" />
            Add more
          </button>
        </li>
      </ul>

      {draft.notices.length > 0 && (
        <div className="mb-2 flex items-start gap-2 rounded-[var(--r-md)] bg-[var(--bg-active)] px-3 py-2 text-sm">
          <div className="flex-1 space-y-1">
            {draft.notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={draft.dismissNotices}
            className="tap-target grid size-6 place-items-center rounded-full hover:bg-[var(--bg-hover)]"
            aria-label="Dismiss message"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-2" aria-label="Send photos and videos">
        <label htmlFor="album-caption" className="sr-only">
          Caption
        </label>
        <textarea
          id="album-caption"
          rows={1}
          value={caption}
          maxLength={LIMITS.MAX_CAPTION_LENGTH}
          onChange={(e) => {
            onCaptionChange(e.target.value);
          }}
          onKeyDown={onCaptionKey}
          onPaste={onPaste}
          enterKeyHint="send"
          placeholder="Add a caption…"
          className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-[22px] border border-transparent bg-[var(--bg-sunken)] px-4 py-[9px] leading-6 text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] focus:border-primary max-sm:text-base"
        />
        <button
          type="submit"
          disabled={!draft.canSend}
          className="btn-grad grid size-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95 disabled:cursor-not-allowed disabled:bg-none disabled:bg-base-content/15 disabled:text-base-content/40 disabled:opacity-100"
          aria-label={`Send ${String(count)} ${count === 1 ? 'item' : 'items'}`}
        >
          <Send className="size-5" aria-hidden="true" />
        </button>
      </form>

      <p role="status" aria-live="polite" className="sr-only">
        {draft.announcement}
      </p>
    </section>
  );
};
