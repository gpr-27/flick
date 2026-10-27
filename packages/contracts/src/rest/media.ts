import { z } from 'zod';
import { HttpUrl, Id, IsoDateTime, MimeType } from '../common.js';

// Files go straight to object storage: the client gets a presigned POST, uploads,
// then calls "complete" so the server can check size and sniff the real type.
// Downloads use a short-lived presigned GET, issued only to conversation members.

export const UploadPurpose = z.enum(['message', 'avatar', 'group_avatar']);

export const PresignUploadRequest = z.object({
  purpose: UploadPurpose,
  mime: MimeType,
  // The server checks the upper limit per purpose so it can say what the limit is and why.
  size: z.number().int().min(1),
  file_name: z.string().min(1).max(255).optional(),
});

export const PresignUploadResponse = z.object({
  attachment_id: Id,
  url: HttpUrl,
  /** Form fields to send with the file (they carry the size limit policy). */
  fields: z.record(z.string(), z.string()),
  expires_at: IsoDateTime,
});

export const AttachmentParams = z.object({ attachment_id: Id });

export const Attachment = z.object({
  id: Id,
  mime: MimeType, // sniffed from the bytes, not the declared type
  size: z.number().int().min(0),
  file_name: z.string().nullable(),
  status: z.enum(['pending', 'ready', 'failed']),
  created_at: IsoDateTime,
});

export const DownloadUrl = z.object({ url: HttpUrl, expires_at: IsoDateTime });

/** `preview=1` asks for a link that shows the file in the browser. Only PDFs are ever served this way. */
export const DownloadUrlQuery = z.object({ preview: z.literal('1').optional() });
