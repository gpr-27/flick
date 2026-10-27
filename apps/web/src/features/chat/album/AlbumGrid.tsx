// An album in a chat: its photos and videos in one grid. Each tile is an ordinary message, so
// the bubble finds the tile under a long press or right-click (data-album-item) and runs the
// message actions on that one.
import { Check, ImageOff, Play } from 'lucide-react';
import { albumLabel } from '@chat/contracts';
import { cn } from '@/components/ui';
import { useAttachmentUrl } from '../content/attachments';
import { TapToDownload } from '@/features/settings/MediaGate';
import { useMediaGate } from '@/features/settings/useMediaGate';
import type { AlbumGroup, ThreadRow } from '../threadRows';
import { albumLayout } from './albumLayout';
import { formatDuration } from './thumbnails';

export const ALBUM_ITEM_ATTR = 'data-album-item';

type MediaContent = Extract<
  NonNullable<ThreadRow['message']['content']>,
  { type: 'image' | 'video' }
>;
const mediaOf = (row: ThreadRow): MediaContent | null => {
  const c = row.message.content;
  return c && (c.type === 'image' || c.type === 'video') ? c : null;
};

const Placeholder = ({ label }: { label: string }) => (
  <div
    role="img"
    aria-label={label}
    className="grid size-full place-items-center bg-[var(--bg-sunken)] text-[var(--text-3)]"
  >
    <ImageOff className="size-6" aria-hidden="true" />
  </div>
);

const TileMedia = ({ content, enabled }: { content: MediaContent; enabled: boolean }) => {
  const { url, failed, fail } = useAttachmentUrl(content.attachment_id, enabled);
  if (failed) return <Placeholder label="Could not load this item" />;
  if (!url) return <div className="size-full animate-pulse bg-[var(--bg-hover)]" />;
  return content.type === 'video' ? (
    <video
      src={`${url}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      tabIndex={-1}
      aria-hidden="true"
      onError={fail}
      className="size-full bg-black object-cover"
    />
  ) : (
    <img
      src={url}
      alt={content.caption ?? ''}
      loading="lazy"
      draggable={false}
      onError={fail}
      className="size-full object-cover"
    />
  );
};

export interface AlbumGridProps {
  group: AlbumGroup;
  onOpen: (attachmentId: string) => void;
  /** Selection mode: tiles show a tick and the bubble handles the tap. */
  selecting: boolean;
  selectedIds: readonly string[];
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}

export const AlbumGrid = ({
  group,
  onOpen,
  selecting,
  selectedIds,
  onRetry,
  onDiscard,
}: AlbumGridProps) => {
  const gate = useMediaGate();
  const firstContent = group.items[0] ? mediaOf(group.items[0]) : null;
  const layout = albumLayout(
    group.count,
    firstContent ? firstContent.width / firstContent.height : 1,
  );
  const label = albumLabel({
    count: group.count,
    videos: group.slots.filter((s) => s && mediaOf(s)?.type === 'video').length,
  });

  return (
    <div>
      <div
        role="group"
        aria-label={label}
        // The height is fixed by the aspect ratio, so the list does not jump when images load.
        style={{
          aspectRatio: String(layout.aspect),
          gridTemplateColumns: layout.columns,
          gridTemplateRows: layout.rows,
        }}
        className="relative grid w-[18rem] max-w-[calc(85vw-3rem)] gap-0.5 overflow-hidden rounded-xl"
      >
        {layout.cells.map((cell, position) => {
          const slot = group.slots[position] ?? null;
          const content = slot ? mediaOf(slot) : null;
          const isLast = position === layout.cells.length - 1;
          const more = isLast ? layout.hidden : 0;
          const style = {
            gridColumn: `${String(cell.col + 1)} / span ${String(cell.colSpan)}`,
            gridRow: `${String(cell.row + 1)} / span ${String(cell.rowSpan)}`,
          };
          if (!slot || !content) {
            return (
              <div key={`missing-${String(position)}`} style={style} className="min-h-0 min-w-0">
                <Placeholder label="This photo or video is not available" />
              </div>
            );
          }
          const id = slot.message.message_id;
          const selected = selectedIds.includes(id);
          const local = slot.local;
          const kind = content.type === 'video' ? 'video' : 'photo';
          return (
            <div key={slot.key} style={style} className="relative min-h-0 min-w-0 overflow-hidden">
              {gate.go ? (
                <button
                  type="button"
                  {...{ [ALBUM_ITEM_ATTR]: id }}
                  onClick={() => {
                    onOpen(content.attachment_id);
                  }}
                  aria-label={
                    more > 0
                      ? `Open ${kind} ${String(position + 1)} of ${String(group.count)}, plus ${String(more - 1)} more`
                      : `Open ${kind} ${String(position + 1)} of ${String(group.count)}`
                  }
                  className={cn(
                    'relative block size-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                    local?.status === 'pending' && 'opacity-70',
                  )}
                >
                  <TileMedia content={content} enabled />
                  {content.type === 'video' && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      <Play className="size-3 fill-current" aria-hidden="true" />
                      {formatDuration(content.duration_ms)}
                    </span>
                  )}
                  {more > 0 && (
                    <span className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-semibold text-white">
                      +{more}
                    </span>
                  )}
                </button>
              ) : (
                <div {...{ [ALBUM_ITEM_ATTR]: id }} className="size-full bg-[var(--bg-sunken)]" />
              )}
              {selecting && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute right-1 top-1 grid size-5 place-items-center rounded-full border-2 border-white',
                    selected ? 'bg-primary text-primary-content' : 'bg-black/30',
                  )}
                >
                  {selected && <Check className="size-3" />}
                </span>
              )}
              {selected && <span className="pointer-events-none absolute inset-0 bg-primary/25" />}
              {local?.status === 'failed' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 p-1 text-center text-[11px] font-semibold text-white">
                  Not sent
                  <span className="flex gap-2">
                    {local.error?.retryable !== false && (
                      <button
                        type="button"
                        className="tap-target underline"
                        onClick={() => {
                          onRetry(local.client_message_id);
                        }}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      className="tap-target underline"
                      onClick={() => {
                        onDiscard(local.client_message_id);
                      }}
                    >
                      Discard
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {!gate.go && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--bg-sunken)]/90">
            <TapToDownload noun={label} onClick={gate.load} />
          </div>
        )}
      </div>
      {group.caption && (
        <p className="mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-relaxed">
          {group.caption}
        </p>
      )}
    </div>
  );
};
