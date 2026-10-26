import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/useFocusTrap';
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

/** Full-screen viewer over all of a chat's photos and videos: arrows, swipe, wheel zoom, Esc. */
export const MediaLightbox = ({
  items,
  startId,
  onClose,
}: {
  items: GalleryItem[];
  startId: string | null;
  onClose: () => void;
}) => {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const swipeStart = useRef<number | null>(null);

  // Only when a new item is opened; new messages arriving must not move the viewer.
  // (Adjusted during render, not in an effect.)
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openedFor !== startId) {
    setOpenedFor(startId);
    if (startId) {
      setIndex(
        Math.max(
          0,
          items.findIndex((i) => i.attachmentId === startId),
        ),
      );
      setZoom(1);
    }
  }

  const go = (step: 1 | -1): void => {
    setIndex((i) => stepIndex(i, step, items.length));
    setZoom(1);
  };

  useEffect(() => {
    if (!startId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId, items.length]);

  const dialogRef = useRef<HTMLDivElement>(null);
  // Keyboard and screen-reader users: focus moves into the viewer and returns to the photo grid.
  useFocusTrap(dialogRef, startId !== null);

  const item = items[index];
  if (!startId || !item) return null;

  const onPointerUp = (e: PointerEvent): void => {
    const from = swipeStart.current;
    swipeStart.current = null;
    if (from === null || zoom > 1) return;
    const dx = e.clientX - from;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  };

  const download = (): void => {
    void downloadAttachment(item.attachmentId);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/90"
      onPointerDown={(e) => {
        swipeStart.current = e.clientX;
      }}
      onPointerUp={onPointerUp}
    >
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          className="btn btn-circle btn-sm"
          onClick={download}
          aria-label="Download"
        >
          <Download className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-circle btn-sm"
          onClick={onClose}
          aria-label="Close media viewer"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
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
      <Slide
        item={item}
        zoom={zoom}
        onWheel={(e) => {
          setZoom((z) => clampZoom(z - e.deltaY / 300));
        }}
      />
      <p className="absolute bottom-3 text-sm text-white/80">
        {index + 1} / {items.length}
        {item.caption ? ` · ${item.caption}` : ''}
      </p>
    </div>
  );
};

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
