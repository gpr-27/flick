// The rules of sending an album, without any React or browser APIs (so they are easy to test).
// An album is N ordinary messages; each item uploads on its own, and the messages are written to
// the outbox in album order as soon as an item and every item before it are done.
import { LIMITS, type MessageContent } from '@chat/contracts';

export type ItemStatus = 'waiting' | 'uploading' | 'ready' | 'failed' | 'sent';
export type ItemKind = 'image' | 'video' | 'file';

export interface UploadResult {
  attachmentId: string;
  width: number;
  height: number;
  durationMs: number;
}

/** Where an item goes once Send is pressed. Items without one are still being chosen. */
export interface ItemBatch {
  /** Items sent together share a batch; the albums of two batches never mix. */
  batchId: string;
  /** Position in the send, from 0. */
  order: number;
  /** Set when the batch is an album of two or more photos/videos. */
  album: { id: string; index: number; count: number; videos: number } | null;
  /** The caption and reply go on the first item. */
  caption: string;
  replyTo: string | null;
}

export interface PlanItem {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  fileName: string;
  fileSize: number;
  result?: UploadResult | undefined;
  batch?: ItemBatch | undefined;
}

/** How many uploads may start now, given the number already running. */
export const uploadSlots = (running: number): number =>
  Math.max(0, LIMITS.MAX_ALBUM_CONCURRENT_UPLOADS - running);

/** Items to start uploading now: the oldest waiting ones, up to the concurrency limit. */
export const nextToUpload = <T extends Pick<PlanItem, 'status'>>(items: readonly T[]): T[] => {
  const running = items.filter((i) => i.status === 'uploading').length;
  return items.filter((i) => i.status === 'waiting').slice(0, uploadSlots(running));
};

/**
 * Items whose message may be written now: uploaded, in a batch, and every earlier item of the
 * batch is already sent or has failed (a failed item does not hold the others back; its message
 * follows when it is retried). Returned in album order.
 */
export const nextToSend = <T extends PlanItem>(items: readonly T[]): T[] => {
  const byBatch = new Map<string, T[]>();
  for (const item of items) {
    if (!item.batch) continue;
    const list = byBatch.get(item.batch.batchId) ?? [];
    list.push(item);
    byBatch.set(item.batch.batchId, list);
  }
  const out: T[] = [];
  for (const group of byBatch.values()) {
    group.sort((a, b) => (a.batch?.order ?? 0) - (b.batch?.order ?? 0));
    for (const item of group) {
      if (item.status === 'sent' || item.status === 'failed') continue;
      if (item.status !== 'ready') break; // waiting or uploading: later ones must wait for it
      out.push(item);
    }
  }
  return out;
};

/** Send is possible while something can still go out: anything not failed and not already sent. */
export const canSend = (items: readonly Pick<PlanItem, 'status' | 'batch'>[]): boolean =>
  items.some((i) => !i.batch && i.status !== 'failed' && i.status !== 'sent');

/**
 * Gives each draft item its place in the send: photos and videos first (they form the album), files after.
 *
 * Limitation: "Send as files" (original quality) turns every item into a `file` message, and the
 * album fields exist only on image and video content, so several originals are NOT grouped into one
 * bubble. They are sent as separate file messages in the order they were picked (`order` below), and
 * the caption and reply go on the first. Grouping would need an `album` field on file content.
 */
export const assignBatch = <T extends PlanItem>(
  items: readonly T[],
  options: { batchId: string; albumId: string; caption: string; replyTo: string | null },
): T[] => {
  const draft = items.filter((i) => !i.batch && i.status !== 'failed' && i.status !== 'sent');
  const media = draft.filter((i) => i.kind !== 'file');
  const files = draft.filter((i) => i.kind === 'file');
  const ordered = [...media, ...files];
  const album =
    media.length >= 2
      ? {
          id: options.albumId,
          count: media.length,
          videos: media.filter((i) => i.kind === 'video').length,
        }
      : null;
  return items.map((item) => {
    const order = ordered.indexOf(item);
    if (order < 0) return item;
    return {
      ...item,
      batch: {
        batchId: options.batchId,
        order,
        album: album && item.kind !== 'file' ? { ...album, index: order } : null,
        caption: order === 0 ? options.caption : '',
        replyTo: order === 0 ? options.replyTo : null,
      },
    };
  });
};

/** The message for one uploaded item. */
export const buildContent = (item: PlanItem): MessageContent => {
  const { batch, result } = item;
  if (!result) throw new Error('The item has not been uploaded yet');
  const extras = {
    ...(batch?.caption ? { caption: batch.caption } : {}),
    ...(batch?.replyTo ? { reply_to: batch.replyTo } : {}),
  };
  if (item.kind === 'file') {
    return {
      type: 'file',
      attachment_id: result.attachmentId,
      file_name: item.fileName,
      size: Math.max(1, item.fileSize),
      ...extras,
    };
  }
  const album = batch?.album
    ? {
        album: {
          id: batch.album.id,
          index: batch.album.index,
          count: batch.album.count,
          ...(batch.album.videos > 0 ? { videos: batch.album.videos } : {}),
        },
      }
    : {};
  if (item.kind === 'video') {
    return {
      type: 'video',
      attachment_id: result.attachmentId,
      width: result.width,
      height: result.height,
      duration_ms: result.durationMs,
      ...album,
      ...extras,
    };
  }
  return {
    type: 'image',
    attachment_id: result.attachmentId,
    width: result.width,
    height: result.height,
    ...album,
    ...extras,
  };
};

/** True when nothing is left to wait for: every item of the list is sent. */
export const allSent = (items: readonly Pick<PlanItem, 'status'>[]): boolean =>
  items.length > 0 && items.every((i) => i.status === 'sent');

/** Counts for the progress announcement ("3 of 5 uploaded"). */
export const progressCounts = (
  items: readonly Pick<PlanItem, 'status'>[],
): { total: number; done: number; failed: number; active: number } => ({
  total: items.length,
  done: items.filter((i) => i.status === 'ready' || i.status === 'sent').length,
  failed: items.filter((i) => i.status === 'failed').length,
  active: items.filter((i) => i.status === 'waiting' || i.status === 'uploading').length,
});
