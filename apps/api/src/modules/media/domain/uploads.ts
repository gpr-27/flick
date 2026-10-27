import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  Attachment,
  DownloadUrl,
  PresignUploadRequest,
  PresignUploadResponse,
} from '@chat/contracts';
import { formatBytes } from '@chat/contracts';
import { fileTypeFromBuffer } from 'file-type';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import type { Db } from '../../../db.js';
import {
  findAttachment,
  insertPending,
  isInMyConversation,
  markDeleted,
  markUploaded,
  type AttachmentRow,
} from '../repo/attachments.js';
import { avatarVariantKey, resizeAvatar } from './avatars.js';
import { MediaError } from './errors.js';
import {
  MAX_BYTES,
  canPreviewInline,
  canShowInline,
  declaredMatches,
  downloadContentType,
  isAvatarKey,
  isTypeAllowed,
  objectKey,
  sanitizeFileName,
} from './rules.js';
import type { Storage } from './storage.js';

const UPLOAD_URL_SECONDS = 10 * 60;
const DOWNLOAD_URL_SECONDS = 5 * 60;
// file-type needs only the start of a file to recognise it.
const SNIFF_BYTES = 4_100;

type PresignBody = z.infer<typeof PresignUploadRequest>;

/** Step 1: record the intent and hand out a presigned POST. The bytes then go straight to storage. */
export async function presignUpload(
  db: Db,
  storage: Storage,
  userId: string,
  body: PresignBody,
): Promise<z.infer<typeof PresignUploadResponse>> {
  if (!isTypeAllowed(body.purpose, body.mime)) {
    throw new MediaError(
      'UNSUPPORTED_MEDIA_TYPE',
      `${body.mime} is not allowed for ${body.purpose}`,
    );
  }
  if (body.size > MAX_BYTES[body.purpose]) {
    throw new MediaError(
      'PAYLOAD_TOO_LARGE',
      `This file is ${formatBytes(body.size)}, but ${body.purpose === 'message' ? 'files' : 'profile pictures'} can be at most ${formatBytes(MAX_BYTES[body.purpose])}. Larger uploads are rejected so they stay reliable for everyone. Send a smaller file or a link instead.`,
    );
  }

  const id = randomUUID();
  const key = objectKey(body.purpose, userId, id);
  await insertPending(db, {
    id,
    ownerId: userId,
    key,
    fileName: sanitizeFileName(body.file_name),
    mime: body.mime,
    size: body.size,
  });

  // S3 itself rejects an upload that is larger than declared or has another Content-Type.
  const post = await createPresignedPost(storage.signer, {
    Bucket: storage.bucket,
    Key: key,
    Conditions: [
      ['content-length-range', 1, body.size],
      ['eq', '$Content-Type', body.mime],
    ],
    Fields: { 'Content-Type': body.mime },
    Expires: UPLOAD_URL_SECONDS,
  });
  return {
    attachment_id: id,
    url: post.url,
    fields: post.fields,
    expires_at: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
  };
}

/** Step 2: check what actually arrived in storage, then mark the row uploaded. */
export async function completeUpload(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
): Promise<z.infer<typeof Attachment>> {
  const row = await findAttachment(db, id);
  if (!row || row.owner_id !== userId || row.status === 'deleted') {
    throw new MediaError('NOT_FOUND', 'Attachment not found');
  }
  if (row.status !== 'pending') return toDto(row); // calling complete twice is harmless

  const head = await storage.client
    .send(new HeadObjectCommand({ Bucket: storage.bucket, Key: row.object_key }))
    .catch((error: unknown) => {
      if ((error as Error).name === 'NotFound') return undefined;
      throw error;
    });
  if (!head) throw new MediaError('UPLOAD_INCOMPLETE', 'The file has not been uploaded yet');

  if (head.ContentLength !== Number(row.size_bytes)) {
    await reject(
      db,
      storage,
      row,
      'VALIDATION_FAILED',
      'Uploaded size does not match the declared size',
    );
  }

  const { detected, sha256 } = await sniffAndHash(
    storage.client,
    storage.bucket,
    row.object_key,
    row.declared_mime,
  );
  if (!declaredMatches(row.declared_mime, detected)) {
    await reject(
      db,
      storage,
      row,
      'UNSUPPORTED_MEDIA_TYPE',
      'File content does not match its declared type',
    );
  }

  if (isAvatarKey(row.object_key)) {
    await resizeAvatar(storage, row.object_key).catch(() =>
      reject(db, storage, row, 'UNSUPPORTED_MEDIA_TYPE', 'Image could not be read'),
    );
  }

  // The declared type is kept. Where we can verify it, it has just been shown to match the bytes;
  // other types are served as downloads only (see canShowInline).
  await markUploaded(db, id, row.declared_mime, sha256);
  const done = await findAttachment(db, id);
  return toDto(done!);
}

/** Step 3: a short-lived link for the owner, for members of the conversation, or for avatars. */
export async function downloadUrl(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
  options: { preview?: boolean } = {},
): Promise<z.infer<typeof DownloadUrl>> {
  const row = await findAttachment(db, id);
  const ready = row && (row.status === 'uploaded' || row.status === 'attached');
  const allowed =
    ready &&
    (row.owner_id === userId ||
      isAvatarKey(row.object_key) ||
      (await isInMyConversation(db, userId, id)));
  // Same 404 for "does not exist" and "not yours", so ids cannot be probed.
  if (!ready || !allowed) throw new MediaError('NOT_FOUND', 'Attachment not found');

  const mime = row.verified_mime ?? row.declared_mime;
  // `preview` only changes how a PDF is shown; any other type is still a download.
  const previewPdf = options.preview === true && canPreviewInline(mime);
  const inline = canShowInline(mime) || previewPdf;
  const isAvatar = isAvatarKey(row.object_key);
  const url = await getSignedUrl(
    storage.signer,
    new GetObjectCommand({
      Bucket: storage.bucket,
      Key: isAvatar ? avatarVariantKey(row.object_key, 256) : row.object_key,
      ResponseContentType: isAvatar
        ? 'image/webp'
        : previewPdf
          ? 'application/pdf'
          : downloadContentType(mime),
      ResponseContentDisposition: previewPdf
        ? `inline; filename="${row.file_name ?? 'file.pdf'}"`
        : inline
          ? 'inline'
          : `attachment; filename="${row.file_name ?? 'file'}"`,
    }),
    { expiresIn: DOWNLOAD_URL_SECONDS },
  );
  return { url, expires_at: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
}

export function toDto(row: AttachmentRow): z.infer<typeof Attachment> {
  return {
    id: row.id,
    mime: row.verified_mime ?? row.declared_mime,
    size: Number(row.size_bytes),
    file_name: row.file_name,
    status: row.status === 'pending' ? 'pending' : row.status === 'deleted' ? 'failed' : 'ready',
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** Deletes the object, marks the row deleted and fails the request. Never returns. */
async function reject(
  db: Db,
  storage: Storage,
  row: AttachmentRow,
  code: 'VALIDATION_FAILED' | 'UNSUPPORTED_MEDIA_TYPE',
  message: string,
): Promise<never> {
  await storage.client.send(
    new DeleteObjectCommand({ Bucket: storage.bucket, Key: row.object_key }),
  );
  await markDeleted(db, row.id);
  throw new MediaError(code, message);
}

/**
 * One pass over the object: hash all bytes, keep the first few to detect the real type.
 * Plain text has no magic bytes, so a file declared as text/plain is accepted only when no
 * known binary signature is found and every byte is valid UTF-8 without a NUL byte.
 */
async function sniffAndHash(client: S3Client, bucket: string, key: string, declared: string) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const hash = createHash('sha256');
  const checkText = declared === 'text/plain';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let validText = checkText;
  let head = Buffer.alloc(0);
  for await (const chunk of object.Body as Readable as AsyncIterable<Buffer>) {
    hash.update(chunk);
    if (head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
    if (validText) {
      if (chunk.includes(0)) validText = false;
      else {
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          validText = false;
        }
      }
    }
  }
  if (validText) {
    try {
      decoder.decode();
    } catch {
      validText = false;
    }
  }
  let detected = (await fileTypeFromBuffer(head))?.mime;
  if (!detected && validText) detected = 'text/plain';
  return { detected, sha256: hash.digest() };
}
