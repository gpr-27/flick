// Files go straight to object storage, never through the API or the socket:
//   presign (API) -> POST the file to the returned URL (S3) -> complete (API checks size + type)
// The returned attachment id is what an image/file message refers to.
import { ENDPOINTS, formatBytes, LIMITS, type UploadPurpose } from '@chat/contracts';
import type { z } from 'zod';
import { getApi } from '@/lib/services';

/** `accept` value for a file input that takes any file. Message attachments are not limited by type. */
export const ANY_FILE_ACCEPT = '*/*';

const EXTENSION_MIMES: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  ico: 'image/vnd.microsoft.icon',
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  raw: 'image/x-raw',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  amr: 'audio/amr',
  mid: 'audio/midi',
  midi: 'audio/midi',
  wma: 'audio/x-ms-wma',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  rtf: 'application/rtf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  apk: 'application/vnd.android.package-archive',
  epub: 'application/epub+zip',
};

/** The MIME type to upload a file with. Browsers leave `type` empty for formats they do not know. */
export const mimeForFile = (file: { name: string; type: string }): string => {
  const declared = file.type.trim().toLowerCase();
  if (/^[\w.+-]+\/[\w.+-]+$/.test(declared)) return declared;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIMES[extension] ?? 'application/octet-stream';
};

// Raster formats every browser can draw in an <img>. Others (HEIC, TIFF, SVG, RAW) go as files.
const DRAWABLE_IMAGES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

export type AttachmentKind = 'image' | 'video' | 'file';

/**
 * How a picked file is sent: a photo or video the browser can play shows inline, anything else
 * (documents, archives, HEIC, RAW, SVG, MKV, unknown types) is a generic "file" message with a
 * file icon, name and size.
 */
export const attachmentKindFor = (file: { name: string; type: string }): AttachmentKind => {
  const mime = mimeForFile(file);
  if (DRAWABLE_IMAGES.has(mime)) return 'image';
  if (['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg', 'video/x-m4v'].includes(mime)) {
    return 'video';
  }
  return 'file';
};

/** Thrown before anything is sent when a file is over the limit. The message says why. */
export class FileTooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(
      `This file is ${formatBytes(size)}, but the limit is ${formatBytes(limit)} per file. ` +
        'Bigger uploads often fail halfway on slow connections, so they are not accepted. ' +
        'Send a smaller file, compress it, or share a link instead.',
    );
    this.name = 'FileTooLargeError';
  }
}

/** The biggest file a purpose accepts, in bytes. */
export const uploadLimitFor = (purpose: z.infer<typeof UploadPurpose>): number =>
  purpose === 'message' ? LIMITS.MAX_UPLOAD_BYTES : LIMITS.MAX_AVATAR_BYTES;

/** Throws FileTooLargeError when the file is over the limit for its purpose. */
export const assertFitsLimit = (
  size: number,
  purpose: z.infer<typeof UploadPurpose> = 'message',
): void => {
  const limit = uploadLimitFor(purpose);
  if (size > limit) throw new FileTooLargeError(size, limit);
};

/**
 * How long one upload may take before we give up and say so. A fixed two minutes is right for a
 * photo but far too short for a 1 GB video, so the allowance grows with the size (it assumes at
 * least 256 KiB/s, about 2 Mbit/s).
 */
const MIN_UPLOAD_TIMEOUT_MS = 120_000;
const SLOWEST_BYTES_PER_SECOND = 256 * 1024;
export const uploadTimeoutMs = (size: number): number =>
  Math.max(MIN_UPLOAD_TIMEOUT_MS, Math.ceil(size / SLOWEST_BYTES_PER_SECOND) * 1000);

/** fetch has no upload progress, so XMLHttpRequest is used when the caller wants a progress bar. */
const postWithProgress = (
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    signal?.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.onabort = () => {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
    };
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => {
      reject(new Error('Upload failed. Check your connection.'));
    };
    // A stuck upload must end with a message and a Retry, not a spinner that never stops.
    xhr.timeout = timeoutMs;
    xhr.ontimeout = () => {
      reject(new Error('The upload took too long. Check your connection and try again.'));
    };
    xhr.send(form);
  });

export const uploadAttachment = async (
  blob: Blob,
  options: {
    purpose: z.infer<typeof UploadPurpose>;
    mime: string;
    fileName: string;
    onProgress?: (fraction: number) => void;
    /** Abort to cancel the upload (the file picker's "remove"). */
    signal?: AbortSignal;
  },
): Promise<string> => {
  assertFitsLimit(blob.size, options.purpose);
  options.signal?.throwIfAborted();
  const api = getApi();
  const presign = await api.call(ENDPOINTS.media.presignUpload, {
    body: {
      purpose: options.purpose,
      mime: options.mime,
      size: blob.size,
      file_name: options.fileName,
    },
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(presign.fields)) form.append(name, value);
  form.append('file', blob, options.fileName); // S3 requires the file field to come last
  if (options.onProgress) {
    await postWithProgress(
      presign.url,
      form,
      options.onProgress,
      uploadTimeoutMs(blob.size),
      options.signal,
    );
  } else {
    const timeout = AbortSignal.timeout(uploadTimeoutMs(blob.size));
    const res = await fetch(presign.url, {
      method: 'POST',
      body: form,
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  }
  await api.call(ENDPOINTS.media.complete, { params: { attachment_id: presign.attachment_id } });
  return presign.attachment_id;
};
