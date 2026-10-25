import { MESSAGE_COLUMNS, searchMessages } from '@chat/db';
import type { SearchHit } from '@chat/contracts';
import type { z } from 'zod';
import type { AuthContext } from '../../../auth-guard.js';
import type { MessageDeps } from '../deps.js';
import { requireMember } from '../repo/access.js';
import { decodeKeyset, encodeKeyset } from './keyset.js';
import { toRecords } from './records.js';

/**
 * Full-text search. The SQL only looks at conversations the caller is currently a member of,
 * and leaves out deleted, expired and "deleted for me" messages.
 */
export async function search(
  deps: MessageDeps,
  auth: AuthContext,
  query: { q: string; conversationId?: string; cursor?: string; limit: number },
): Promise<{ items: z.infer<typeof SearchHit>[]; next_cursor: string | null }> {
  if (query.conversationId) await requireMember(deps.db, query.conversationId, auth.userId);
  const after = query.cursor ? decodeKeyset(query.cursor) : undefined;
  const hits = await searchMessages(deps.db, auth.userId, query.q, query.limit + 1, {
    conversationId: query.conversationId,
    after: after && { createdAtText: after.at, id: after.id },
  });

  const page = hits.slice(0, query.limit);
  const rows = page.length
    ? await deps.db
        .selectFrom('messages')
        .select(MESSAGE_COLUMNS)
        .where(
          'id',
          'in',
          page.map((h) => h.id),
        )
        .execute()
    : [];
  const records = new Map(
    (await toRecords(deps.db, auth.userId, rows)).map((r) => [r.message_id, r]),
  );

  const items = page.flatMap((hit) => {
    const message = records.get(hit.id);
    // A record without content is one the viewer may no longer read (a view-once message they
    // opened). Its snippet would show the text the record hides, so it is not a hit.
    return message?.content ? [{ message, snippet: toSnippet(hit.snippet) }] : [];
  });
  const last = page[page.length - 1];
  return {
    items,
    next_cursor:
      hits.length > query.limit && last ? encodeKeyset(last.created_at_text, last.id) : null,
  };
}

/** The database marks hits with U+0001/U+0002. Escape the text first, then add the only markup allowed. */
export function toSnippet(headline: string): string {
  return headline
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\u0001', '<mark>')
    .replaceAll('\u0002', '</mark>');
}
