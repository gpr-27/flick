// The notification centre's queries. A row says "this person was alerted about this message"; the
// text, sender and chat name are read live, so a deleted, expired or hidden message cannot leak.
import type { NotificationItem } from '@chat/contracts';
import type { NotificationKind as StoredKind } from '@chat/db';
import { previewOf } from '@chat/shared';
import { sql } from 'kysely';
import { userAvatarUrl } from '../../avatars.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { ApiError } from '../conversations/http/errors.js';
import { decodeCursor, encodeCursor } from '../conversations/repo/cursor.js';

/** Alerts older than this are not listed (and the daily job deletes them). */
export const KEEP_DAYS = 30;

export interface NewAlert {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  kind: StoredKind;
}

/**
 * Stores alerts, skipping any that already exist (a message alerts a person once, even if the
 * dispatcher or the job runs twice). Returns the rows that were really new.
 */
export async function insertAlerts(db: Db, alerts: NewAlert[]) {
  if (alerts.length === 0) return [];
  return db
    .insertInto('notifications')
    .values(
      alerts.map((a) => ({
        user_id: a.userId,
        conversation_id: a.conversationId,
        message_id: a.messageId,
        kind: a.kind,
        // Not now(): one dispatcher batch is one transaction, and the list must keep message order.
        created_at: sql<Date>`clock_timestamp()`,
      })),
    )
    .onConflict((oc) => oc.columns(['user_id', 'message_id']).doNothing())
    .returning(['id', 'user_id', 'kind', 'conversation_id', 'message_id', 'created_at'])
    .execute();
}

// An alert counts as read when it was marked, or when the chat has been read up to that message.
const IS_READ = sql<boolean>`(n.read_at IS NOT NULL OR (m.seq IS NOT NULL AND cm.read_seq >= m.seq))`;

function visibleAlerts(db: Db, userId: string) {
  return db
    .selectFrom('notifications as n')
    .leftJoin('messages as m', 'm.id', 'n.message_id')
    .leftJoin('conversations as c', 'c.id', 'n.conversation_id')
    .leftJoin('conversation_members as cm', (join) =>
      join.onRef('cm.conversation_id', '=', 'n.conversation_id').on('cm.user_id', '=', userId),
    )
    .where('n.user_id', '=', userId)
    .where(sql<boolean>`n.created_at > now() - make_interval(days => ${KEEP_DAYS})`);
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const row = await visibleAlerts(db, userId)
    .select(sql<number>`count(*) FILTER (WHERE NOT ${IS_READ})::int`.as('unread'))
    .executeTakeFirstOrThrow();
  return row.unread;
}

export async function listAlerts(
  db: Db,
  config: Config,
  userId: string,
  query: { cursor?: string; limit: number },
) {
  const after = query.cursor ? decodeCursor(query.cursor).split('|') : null;
  if (after && after.length !== 2) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');

  const rows = await visibleAlerts(db, userId)
    .leftJoin('users as s', 's.id', 'm.sender_id')
    .leftJoin('hidden_messages as h', (join) =>
      join.onRef('h.message_id', '=', 'n.message_id').on('h.user_id', '=', userId),
    )
    .select([
      'n.id',
      'n.kind',
      'n.created_at',
      'n.conversation_id',
      'n.message_id',
      'm.seq',
      'm.type as message_type',
      'm.body_text',
      'm.view_once',
      'c.type as conversation_type',
      'c.name as conversation_name',
      's.display_name as sender_name',
      's.avatar_object_key',
      's.avatar_url',
      sql<boolean>`${IS_READ}`.as('is_read'),
      sql<boolean>`(m.id IS NOT NULL AND m.deleted_at IS NULL
        AND (m.expire_at IS NULL OR m.expire_at > now())
        AND h.message_id IS NULL AND cm.left_at IS NULL)`.as('available'),
      sql<string>`n.created_at::text`.as('created_text'),
    ])
    .$if(after !== null, (qb) =>
      qb.where(
        sql<boolean>`(n.created_at, n.id) < (${after![0]}::timestamptz, ${after![1]}::uuid)`,
      ),
    )
    .orderBy('n.created_at', 'desc')
    .orderBy('n.id', 'desc')
    .limit(query.limit + 1)
    .execute();
  const page = rows.slice(0, query.limit);

  const items: NotificationItem[] = page.map((r) => {
    const isGroup = r.conversation_type === 'group';
    return {
      id: r.id,
      kind: r.kind,
      created_at: r.created_at.toISOString(),
      read: r.is_read,
      conversation_id: r.conversation_id,
      message_id: r.message_id,
      seq: r.seq === null ? null : Number(r.seq),
      available: r.available,
      // Nothing about a message the person can no longer see.
      sender_name: r.available ? r.sender_name : null,
      sender_avatar_url: r.available
        ? userAvatarUrl(config, {
            avatar_object_key: r.avatar_object_key,
            avatar_url: r.avatar_url,
          })
        : null,
      chat_name: isGroup ? r.conversation_name : r.available ? r.sender_name : null,
      is_group: isGroup,
      preview: r.available ? previewFor(r.kind, r.message_type, r.body_text, r.view_once) : null,
    };
  });
  const last = page[page.length - 1];
  return {
    items,
    next_cursor:
      rows.length > query.limit && last ? encodeCursor(`${last.created_text}|${last.id}`) : null,
    unread_count: await unreadCount(db, userId),
  };
}

function previewFor(
  kind: StoredKind,
  type: string | null,
  bodyText: string | null,
  viewOnce: boolean | null,
): string | null {
  if (kind === 'missed_call') return 'Missed call';
  if (!type) return kind === 'reminder' ? 'Reminder' : null;
  return previewOf({ type, bodyText, viewOnce: viewOnce ?? false });
}

/** Marks the given alerts (or all of them) read. Only the caller's own rows are touched. */
export async function markRead(db: Db, userId: string, input: { ids: string[] } | { all: true }) {
  await db
    .updateTable('notifications')
    .set({ read_at: sql<Date>`now()` })
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .$if('ids' in input, (qb) => qb.where('id', 'in', 'ids' in input ? input.ids : []))
    .execute();
}

export async function clearAlerts(db: Db, userId: string): Promise<void> {
  await db.deleteFrom('notifications').where('user_id', '=', userId).execute();
}
