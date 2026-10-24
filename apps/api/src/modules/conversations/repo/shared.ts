// The "media, links and files" tab of a chat: the messages that carry something worth finding again.
import type { MessageRecord } from '@chat/contracts';
import { MESSAGE_COLUMNS, visibleTo } from '@chat/db';
import { sql, type Expression, type SqlBool } from 'kysely';
import type { Db } from '../../../db.js';
import { toRecords } from '../../messages/domain/records.js';

export type SharedKind = 'media' | 'files' | 'links';

/** Which messages belong to each tab. A link is any text message that contains http(s)://. */
const FILTERS: Record<SharedKind, Expression<SqlBool>> = {
  media: sql<SqlBool>`messages.type IN ('image', 'video', 'gif')`,
  files: sql<SqlBool>`messages.type = 'file'`,
  links: sql<SqlBool>`messages.type = 'text' AND messages.body_text ~* 'https?://'`,
};

/** Newest first, keyed on seq like the history. Deleted and hidden messages are left out. */
export async function listShared(
  db: Db,
  userId: string,
  conversationId: string,
  input: { kind: SharedKind; beforeSeq?: number; limit: number },
): Promise<{ items: MessageRecord[]; next_cursor: string | null }> {
  let q = db
    .selectFrom('messages')
    .select(MESSAGE_COLUMNS)
    .where('conversation_id', '=', conversationId)
    .where('deleted_at', 'is', null)
    .where(FILTERS[input.kind])
    .where(visibleTo(userId));
  if (input.beforeSeq !== undefined) q = q.where('seq', '<', input.beforeSeq);
  // One extra row tells us whether another page exists, without a COUNT.
  const rows = await q
    .orderBy('seq', 'desc')
    .limit(input.limit + 1)
    .execute();
  const page = rows.slice(0, input.limit);
  return {
    items: await toRecords(db, userId, page),
    next_cursor: rows.length > input.limit ? String(page[page.length - 1]!.seq) : null,
  };
}
