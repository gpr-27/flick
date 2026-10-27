import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Forward, X } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
import { useBackClose } from '@/lib/useBackClose';
import { getAttachmentUrl, useAttachmentUrl } from '@/features/chat/content/attachments';
import { clampZoom, stepIndex, type GalleryItem } from './gallery';

const Slide = ({
  item,
  zoom,
  onWheel,
}: {
  item: GalleryItem;
  zoom: number;
  onWheel: (e: WheelEvent) => void;
}) => {
  const { url } = useAttachmentUrl(item.attachmentId);
  if (!url) return null;
  return item.kind === 'video' ? (
    <video src={url} controls autoPlay playsInline className="max-h-[85vh] max-w-full" />
  ) : (
    <img
      src={url}
      alt={item.caption ?? 'Attachment preview'}
      onWheel={onWheel}
      draggable={false}
      style={{ transform: `scale(${zoom})` }}
      className="max-h-[85vh] max-w-full select-none transition-transform"
    />
  );
};

/** The page behind the viewer cannot be reached by keyboard, screen reader or scroll. */
const useBackgroundInert = (viewer: React.RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const touched: { el: HTMLElement; inert: boolean; hidden: string | null }[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement) || el === viewer.current) continue;
      touched.push({ el, inert: el.hasAttribute('inert'), hidden: el.getAttribute('aria-hidden') });
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      for (const { el, inert, hidden } of touched) {
        if (!inert) el.removeAttribute('inert');
        if (hidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', hidden);
      }
    };
  }, [viewer]);
};

const Viewer = ({
  items,
  startId,
  onClose,
  onForward,
}: {
  items: GalleryItem[];
  startId: string;
  onClose: () => void;
  onForward?: ((messageId: string) => void) | undefined;
}) => {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((i) => i.attachmentId === startId),
    ),
  );
  const [zoom, setZoom] = useState(1);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The phone/browser Back button closes the viewer (one history entry, see lib/backStack).
  useBackClose(true, onClose);
  const close = onClose;
  useBackgroundInert(dialogRef);
  // Keyboard and screen-reader users: focus moves into the viewer and returns to the tile.
  useFocusTrap(dialogRef, true);

  const go = (step: 1 | -1): void => {
    setIndex((i) => stepIndex(i, step, items.length));
    setZoom(1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, close]);

  const item = items[index];
  if (!item) return null;

  const onPointerUp = (e: PointerEvent): void => {
    const from = swipeStart.current;
    swipeStart.current = null;
    if (from === null || zoom > 1) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (dy > 100 && dy > Math.abs(dx) * 1.5)
      close(); // swipe down
    else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  const bar = 'btn btn-circle btn-ghost size-11 min-h-11 text-white hover:bg-white/15';

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      data-testid="media-viewer"
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-black/95"
      onPointerDown={(e) => {
        swipeStart.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={onPointerUp}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 pb-6 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] text-white">
        <button
          type="button"
          className="btn btn-ghost min-h-11 gap-1 px-3 text-white hover:bg-white/15"
          onClick={close}
          aria-label="Back"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          <span className="max-sm:sr-only">Back</span>
        </button>
        <p className="text-sm font-medium tabular-nums" aria-live="polite">
          {index + 1} of {items.length}
        </p>
        <div className="flex items-center">
          {onForward && item.messageId && (
            <button
              type="button"
              className={bar}
              aria-label="Forward"
              onClick={() => {
                const id = item.messageId;
                close();
                if (id) onForward(id);
              }}
            >
              <Forward className="size-5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={bar}
            onClick={() => {
              void downloadAttachment(item.attachmentId);
            }}
            aria-label="Download"
          >
            <Download className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={bar} onClick={close} aria-label="Close media viewer">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {index > 0 && (
        <button
          type="button"
          className="btn btn-circle absolute left-3 z-10"
          onClick={() => {
            go(-1);
          }}
          aria-label="Previous"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          type="button"
          className="btn btn-circle absolute right-3 z-10"
          onClick={() => {
            go(1);
          }}
          aria-label="Next"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      )}
      {/* Tapping the dark area closes; tapping the photo itself does not. */}
      <div
        data-testid="media-viewer-backdrop"
        className="flex size-full items-center justify-center px-14 py-16"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <Slide
          item={item}
          zoom={zoom}
          onWheel={(e) => {
            setZoom((z) => clampZoom(z - e.deltaY / 300));
          }}
        />
      </div>
      {item.caption && (
        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6 text-center text-sm text-white/90">
          {item.caption}
        </p>
      )}
    </div>,
    document.body,
  );
};

/** Full-screen viewer over all of a chat's photos and videos, above everything else in the app. */
export const MediaLightbox = ({
  items,
  startId,
  onClose,
  onForward,
}: {
  items: GalleryItem[];
  startId: string | null;
  onClose: () => void;
  /** Shows a Forward button; gets the id of the message whose photo or video is on screen. */
  onForward?: (messageId: string) => void;
}) =>
  startId ? (
    // Remounted per opening, so every opening starts at the tapped item with fresh history state.
    <Viewer items={items} startId={startId} onClose={onClose} onForward={onForward} />
  ) : null;

/** Opens the signed link in a new tab with the download flag; the browser saves it. */
const downloadAttachment = async (attachmentId: string): Promise<void> => {
  const url = await getAttachmentUrl(attachmentId);
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  a.target = '_blank';
  a.click();
};
