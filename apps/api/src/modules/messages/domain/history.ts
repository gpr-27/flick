import type { MessageRecord } from '@chat/contracts';
import { keysetHistory } from '@chat/db';
import type { AuthContext } from '../../../auth-guard.js';
import type { MessageDeps } from '../deps.js';
import { requireMember } from '../repo/access.js';
import { toRecords } from './records.js';

/**
 * Newest first. `beforeSeq` is the smallest seq the client already has. The page is keyed on
 * seq (never OFFSET), so messages that arrive while the user scrolls cannot shift a page.
 * Messages deleted for everyone appear as tombstones; expired and "deleted for me" ones do not.
 */
export async function getHistory(
  deps: MessageDeps,
  auth: AuthContext,
  query: { conversationId: string; beforeSeq?: number; limit: number },
): Promise<{ items: MessageRecord[]; next_cursor: string | null }> {
  await requireMember(deps.db, query.conversationId, auth.userId);
  const page = await keysetHistory(deps.db, {
    conversationId: query.conversationId,
    direction: 'backward',
    cursor: query.beforeSeq,
    limit: query.limit,
    viewerId: auth.userId,
  });
  return {
    items: await toRecords(deps.db, auth.userId, page.messages),
    next_cursor: page.nextCursor === null ? null : String(page.nextCursor),
  };
}
