import type { MessageRecord } from '@chat/contracts';

export interface GalleryItem {
  attachmentId: string;
  kind: 'image' | 'video';
  caption?: string | undefined;
  /** The message it belongs to (for Forward). */
  messageId?: string | undefined;
}

/** Every photo and video of a chat, oldest first, for the full-screen viewer to page through. */
export const galleryItems = (messages: readonly MessageRecord[]): GalleryItem[] => {
  const items: GalleryItem[] = [];
  for (const m of messages) {
    const c = m.content;
    if (m.deleted_at || !c) continue;
    if (c.type === 'image' || c.type === 'video') {
      items.push({
        attachmentId: c.attachment_id,
        kind: c.type,
        caption: c.caption,
        messageId: m.message_id,
      });
    }
  }
  return items;
};

/** Index to move to from `index`, one step, staying inside the list. */
export const stepIndex = (index: number, step: 1 | -1, length: number): number =>
  Math.min(length - 1, Math.max(0, index + step));

/** Zoom after a wheel tick or pinch, kept between 1x and 5x. */
export const clampZoom = (zoom: number): number => Math.min(5, Math.max(1, zoom));
