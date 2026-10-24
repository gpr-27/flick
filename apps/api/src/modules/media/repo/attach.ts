import type { Db } from '../../../db.js';
import { MediaError } from '../domain/errors.js';
import { isAvatarKey } from '../domain/rules.js';
import { findAttachment, type AttachmentRow } from './attachments.js';

// These two are for the messages module. Pass the send transaction as `db` so that
// "attach" commits or rolls back together with the message.

/** The attachment must be the sender's own, fully uploaded, and not used by another message. */
export async function assertAttachmentUsable(
  db: Db,
  userId: string,
  attachmentId: string,
): Promise<AttachmentRow> {
  const row = await findAttachment(db, attachmentId);
  // Same answer for "missing" and "someone else's", so ids cannot be probed.
  if (!row || row.owner_id !== userId || row.status === 'deleted') {
    throw new MediaError('NOT_FOUND', 'Attachment not found');
  }
  if (row.status === 'pending') {
    throw new MediaError('UPLOAD_INCOMPLETE', 'The upload has not been completed');
  }
  if (row.status === 'attached') {
    throw new MediaError('CONFLICT', 'Attachment is already used by a message');
  }
  if (isAvatarKey(row.object_key)) {
    throw new MediaError('VALIDATION_FAILED', 'Avatars cannot be sent as messages');
  }
  return row;
}

/** Returns false when someone attached it first (two sends racing with the same attachment). */
export async function markAttached(db: Db, attachmentId: string): Promise<boolean> {
  const res = await db
    .updateTable('attachments')
    .set({ status: 'attached' })
    .where('id', '=', attachmentId)
    .where('status', '=', 'uploaded')
    .executeTakeFirst();
  return res.numUpdatedRows === 1n;
}
