import {
  LIMITS,
  type MessageRecord,
  type SyncEvent,
  type SyncPagePayload,
  type SyncRequestPayload,
} from '@chat/contracts';
import { MESSAGE_COLUMNS, type MessageRow } from '@chat/db';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AuthContext } from '../../../auth-guard.js';
import { ApiError } from '../errors.js';
import type { MessageDeps } from '../deps.js';
import { requireMember } from '../repo/access.js';
import { fromRow } from './content.js';
import { toRecords } from './records.js';

interface LogRow {
  seq: number;
  // null for a message row, otherwise the message_events type
  event_type: string | null;
  message_id: string;
  user_id: string | null;
  emoji: string | null;
  created_at: Date;
}

export interface ConversationSync {
  events: SyncEvent[];
  hasMore: boolean;
  /** The highest seq in this page; ask for the next page with after_seq = lastSeq. */
  lastSeq: number;
}

/**
 * Everything that happened in one conversation after `afterSeq`, in seq order: new messages
 * plus edits, deletes and reactions (they take seqs too, see message_events).
 *
 * Both sources are read in ONE statement, so the page is a single snapshot. Seqs commit in
 * order (the conversation row is locked while a seq is taken), so if the page contains seq N,
 * every seq below N is already visible and none can appear later behind the cursor. New
 * messages arriving during paging only add higher seqs.
 */
export async function syncConversation(
  deps: MessageDeps,
  auth: AuthContext,
  query: { conversationId: string; afterSeq: number; limit: number },
): Promise<ConversationSync> {
  await requireMember(deps.db, query.conversationId, auth.userId);
  const { conversationId, afterSeq } = query;
  const limit = Math.min(Math.max(query.limit, 1), LIMITS.MAX_SYNC_PAGE_SIZE);

  // Each side is limited on its own: the first limit+1 rows of the union can only come from
  // the first limit+1 rows of either side.
  const { rows } = await sql<LogRow>`
    (SELECT seq, NULL::text AS event_type, id AS message_id, NULL::uuid AS user_id,
            NULL::text AS emoji, created_at
       FROM messages
      WHERE conversation_id = ${conversationId} AND seq > ${afterSeq}
      ORDER BY seq LIMIT ${limit + 1})
    UNION ALL
    (SELECT seq, type::text, message_id, user_id, emoji, created_at
       FROM message_events
      WHERE conversation_id = ${conversationId} AND seq > ${afterSeq}
      ORDER BY seq LIMIT ${limit + 1})
    ORDER BY seq
    LIMIT ${limit + 1}
  `.execute(deps.db);

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  if (page.length === 0) return { events: [], hasMore: false, lastSeq: afterSeq };

  const messages = await loadMessages(deps, page);
  const hidden = await hiddenIds(deps, auth.userId, [...messages.keys()]);
  const newMessages = page.filter((r) => r.event_type === null);
  const records = new Map(
    (
      await toRecords(
        deps.db,
        auth.userId,
        newMessages.flatMap((r) => messages.get(r.message_id) ?? []),
        { hiddenAsTombstone: true },
      )
    ).map((record) => [record.message_id, record]),
  );

  const events: SyncEvent[] = [];
  for (const row of page) {
    const message = messages.get(row.message_id);
    if (!message) continue; // purged by the disappearing-message cleanup since the page was read
    const event = toEvent(row, message, records.get(row.message_id), hidden.has(row.message_id));
    if (event) events.push(event);
  }
  return { events, hasMore, lastSeq: page[page.length - 1]!.seq };
}

function toEvent(
  row: LogRow,
  message: MessageRow,
  record: MessageRecord | undefined,
  hiddenForMe: boolean,
): SyncEvent | null {
  const base = {
    conversation_id: message.conversation_id,
    seq: row.seq,
    message_id: row.message_id,
  };
  switch (row.event_type) {
    case null:
      return record ? { type: 'new_message', payload: { message: record } } : null;
    case 'edited': {
      const gone =
        message.deleted_at !== null ||
        hiddenForMe ||
        (message.expire_at !== null && message.expire_at.getTime() <= Date.now());
      // Content that is no longer visible must not be replayed. The device ends up in the
      // right state if it sees a delete at this seq instead of the edit.
      if (gone) return deletedEvent(base, row);
      return {
        type: 'message_edited',
        payload: {
          ...base,
          content: fromRow(message),
          edited_at: (message.edited_at ?? row.created_at).toISOString(),
        },
      };
    }
    case 'deleted':
      return deletedEvent(base, row);
    case 'reaction_added':
    case 'reaction_removed':
      return {
        type: row.event_type,
        // user_id is only null if the user row was removed, which never happens (users are
        // soft-deleted), so the cast is safe.
        payload: { ...base, user_id: row.user_id!, emoji: row.emoji! },
      };
    default:
      return null;
  }
}

function deletedEvent(
  base: { conversation_id: string; seq: number; message_id: string },
  row: LogRow,
): SyncEvent {
  return {
    type: 'message_deleted',
    payload: { ...base, deleted_by: row.user_id!, deleted_at: row.created_at.toISOString() },
  };
}

async function loadMessages(deps: MessageDeps, rows: LogRow[]): Promise<Map<string, MessageRow>> {
  const found = await deps.db
    .selectFrom('messages')
    .select(MESSAGE_COLUMNS)
    .where('id', 'in', [...new Set(rows.map((r) => r.message_id))])
    .execute();
  return new Map(found.map((m) => [m.id, m]));
}

async function hiddenIds(deps: MessageDeps, userId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Set<string>();
  const rows = await deps.db
    .selectFrom('hidden_messages')
    .select('message_id')
    .where('user_id', '=', userId)
    .where('message_id', 'in', messageIds)
    .execute();
  return new Set(rows.map((r) => r.message_id));
}

// ----------------------------------------------------------- many conversations at once

// The paging position across conversations: which cursor we are in, and the seq to continue after.
const PageCursor = z.object({ i: z.number().int().min(0), a: z.number().int().min(0).nullable() });

function decodeCursor(cursor: string) {
  try {
    return PageCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Invalid sync cursor.');
  }
}

function encodeCursor(i: number, a: number | null): string {
  return Buffer.from(JSON.stringify({ i, a })).toString('base64url');
}

/**
 * The WebSocket `sync_request` and POST /sync. The device sends its highest gapless seq per
 * conversation; the answer fills the page up to `limit` events, conversation by conversation.
 * Conversations the user has left are reported in removed_conversation_ids.
 */
export async function syncMany(
  deps: MessageDeps,
  auth: AuthContext,
  request: z.infer<typeof SyncRequestPayload>,
): Promise<z.infer<typeof SyncPagePayload>> {
  const { cursors, limit } = request;
  const start = request.cursor ? decodeCursor(request.cursor) : { i: 0, a: null };

  const memberRows = cursors.length
    ? await deps.db
        .selectFrom('conversation_members')
        .select('conversation_id')
        .where('user_id', '=', auth.userId)
        .where('left_at', 'is', null)
        .where(
          'conversation_id',
          'in',
          cursors.map((c) => c.conversation_id),
        )
        .execute()
    : [];
  const memberOf = new Set(memberRows.map((r) => r.conversation_id));

  const events: SyncEvent[] = [];
  const removed = new Set<string>();
  let nextCursor: string | null = null;

  for (let i = start.i; i < cursors.length; i++) {
    const { conversation_id: conversationId, after_seq: cursorSeq } = cursors[i]!;
    if (!memberOf.has(conversationId)) {
      removed.add(conversationId);
      continue;
    }
    const afterSeq = i === start.i && start.a !== null ? start.a : cursorSeq;
    const room = limit - events.length;
    if (room <= 0) {
      nextCursor = encodeCursor(i, afterSeq);
      break;
    }
    const page = await syncConversation(deps, auth, { conversationId, afterSeq, limit: room });
    events.push(...page.events);
    if (page.hasMore) {
      nextCursor = encodeCursor(i, page.lastSeq);
      break;
    }
  }
  return { events, removed_conversation_ids: [...removed], next_cursor: nextCursor };
}
