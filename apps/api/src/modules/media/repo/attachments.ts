import type { Selectable } from 'kysely';
import type { AttachmentsTable } from '@chat/db';
import type { Db } from '../../../db.js';

export type AttachmentRow = Selectable<AttachmentsTable>;

export async function insertPending(
  db: Db,
  v: {
    id: string;
    ownerId: string;
    key: string;
    fileName: string | null;
    mime: string;
    size: number;
  },
): Promise<void> {
  await db
    .insertInto('attachments')
    .values({
      id: v.id,
      owner_id: v.ownerId,
      object_key: v.key,
      file_name: v.fileName,
      declared_mime: v.mime,
      size_bytes: v.size,
    })
    .execute();
}

export function findAttachment(db: Db, id: string) {
  return db.selectFrom('attachments').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function markUploaded(
  db: Db,
  id: string,
  mime: string,
  sha256: Buffer,
): Promise<boolean> {
  const res = await db
    .updateTable('attachments')
    .set({ status: 'uploaded', verified_mime: mime, sha256 })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return res.numUpdatedRows === 1n;
}

export async function markDeleted(db: Db, id: string): Promise<void> {
  await db.updateTable('attachments').set({ status: 'deleted' }).where('id', '=', id).execute();
}

/** True when the attachment is in a message of a conversation the user is still a member of. */
export async function isInMyConversation(
  db: Db,
  userId: string,
  attachmentId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('messages')
    .innerJoin('conversation_members as m', 'm.conversation_id', 'messages.conversation_id')
    .select('messages.id')
    .where('messages.attachment_id', '=', attachmentId)
    .where('m.user_id', '=', userId)
    .where('m.left_at', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}
