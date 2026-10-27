// Uploads one picked file the same way the single-file flow does: photos are shrunk to a
// chat-sized JPEG first, videos are read for their size and length, files go up as they are.
import { prepareImage } from '@/lib/imageCompress';
import { readVideoMeta } from '@/features/content/videoMeta';
import { assertFitsLimit, mimeForFile, uploadAttachment } from '../upload';
import type { ItemKind, UploadResult } from './albumPlan';

export const uploadItem = async (
  file: File,
  kind: ItemKind,
  options: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<UploadResult> => {
  assertFitsLimit(file.size); // before reading or compressing anything
  const common = { purpose: 'message', fileName: file.name, ...options } as const;
  if (kind === 'image') {
    const image = await prepareImage(file);
    options.signal.throwIfAborted();
    const attachmentId = await uploadAttachment(image.blob, {
      ...common,
      mime: image.blob.type || mimeForFile(file),
    });
    return { attachmentId, width: image.width, height: image.height, durationMs: 1 };
  }
  if (kind === 'video') {
    const meta = await readVideoMeta(file);
    options.signal.throwIfAborted();
    const attachmentId = await uploadAttachment(file, { ...common, mime: mimeForFile(file) });
    return { attachmentId, width: meta.width, height: meta.height, durationMs: meta.durationMs };
  }
  const attachmentId = await uploadAttachment(file, { ...common, mime: mimeForFile(file) });
  return { attachmentId, width: 1, height: 1, durationMs: 1 };
};
