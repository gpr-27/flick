import type { ChatPrefs, ConversationSummary, MessageRecord, UserSummary } from '@chat/contracts';
import { FLICK_BOT_USER_ID, MESSAGE_COLUMNS, buildChatListQuery, type MessageRow } from '@chat/db';
import { sql } from 'kysely';
import type { Config } from '../../../config.js';
import type { Db } from '../../../db.js';
import { notFound } from '../http/errors.js';
import { mediaUrl } from '../../../avatars.js';
import { USER_COLUMNS, toUserSummary } from './core.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { toRecords } from '../../messages/domain/records.js';

// The chat list is the DB helper's query (active memberships only, newest activity first,
// unread = last_seq - read_seq) plus the extra columns the summary needs.
function chatListRows(db: Db, userId: string) {
  return buildChatListQuery(db, userId).select([
    'c.created_at',
    'c.description',
    'c.disappearing_seconds',
    'c.admin_only_send',
    'c.admin_only_edit',
    'c.approval_required',
    'c.saved_for',
    'cm.wallpaper',
    'cm.lock_hash',
  ]);
}
type ListRow = Awaited<ReturnType<ReturnType<typeof chatListRows>['execute']>>[number];

export type ListFilter = 'all' | 'unread' | 'groups' | 'favorites' | 'archived';

const FILTERS: Record<ListFilter, (r: ListRow) => boolean> = {
  all: (r) => !r.archived,
  unread: (r) => !r.archived && r.unread_count > 0,
  groups: (r) => !r.archived && r.type === 'group',
  favorites: (r) => !r.archived && r.favourite,
  archived: (r) => r.archived,
};

/**
 * One page of the caller's chats: pinned first, then newest activity. The helper returns the
 * caller's chats in one query (a person has tens of chats, not millions), so filtering and
 * paging happen on that list. The cursor is the id of the last chat of the previous page.
 */
export async function listConversations(
  db: Db,
  config: Config,
  userId: string,
  query: { filter: ListFilter; cursor?: string; limit: number },
) {
  const rows = (await chatListRows(db, userId).execute()).filter(FILTERS[query.filter]);
  // Array.sort is stable, so equal pin times keep the helper's activity order.
  rows.sort((a, b) => (b.pinned_at?.getTime() ?? 0) - (a.pinned_at?.getTime() ?? 0));

  const start = query.cursor ? rows.findIndex((r) => r.id === query.cursor) + 1 : 0;
  const page = rows.slice(start, start + query.limit);
  const hasMore = start + query.limit < rows.length;
  return {
    items: await toSummaries(db, config, userId, page),
    next_cursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** One conversation for a member. A non-member (or a user who left) gets 404 from the query itself. */
export async function getConversation(
  db: Db,
  config: Config,
  userId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const rows = await chatListRows(db, userId).where('c.id', '=', conversationId).execute();
  if (rows.length === 0) throw notFound();
  return (await toSummaries(db, config, userId, rows))[0]!;
}

async function toSummaries(
  db: Db,
  config: Config,
  userId: string,
  rows: ListRow[],
): Promise<ConversationSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const counts = await db
    .selectFrom('conversation_members')
    .select(['conversation_id', (eb) => eb.fn.countAll<number>().as('n')])
    .where('conversation_id', 'in', ids)
    .where('left_at', 'is', null)
    .groupBy('conversation_id')
    .execute();
  const memberCount = new Map(counts.map((c) => [c.conversation_id, Number(c.n)]));

  const directIds = rows.filter((r) => r.type === 'direct').map((r) => r.id);
  const peers = new Map<string, UserSummary>();
  if (directIds.length > 0) {
    const peerRows = await db
      .selectFrom('conversation_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['cm.conversation_id', ...USER_COLUMNS])
      .where('cm.conversation_id', 'in', directIds)
      .where('cm.user_id', '!=', userId)
      .execute();
    for (const p of peerRows) peers.set(p.conversation_id, toUserSummary(config, p));
  }

  const withMessages = rows.filter((r) => r.last_seq > 0);
  const lastMessages = new Map<string, MessageRecord>();
  if (withMessages.length > 0) {
    // The newest MESSAGE of each chat. last_seq is not enough: an edit, a delete or a reaction
    // takes a seq too (see message_events), so the row at last_seq may not exist in `messages`.
    const columns = sql.raw(MESSAGE_COLUMNS.map((c) => `m.${c}`).join(', '));
    const { rows: messages } = await sql<MessageRow>`
      SELECT ${columns}
      FROM unnest(${withMessages.map((r) => r.id)}::uuid[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT * FROM messages WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1
      ) m
    `.execute(db);
    // The very same conversion the history and sync use, so the preview can never be a different
    // (and possibly invalid) shape. A message the viewer deleted for themselves, or that has
    // expired, shows as a tombstone instead of leaking its text.
    for (const record of await toRecords(db, userId, messages, { hiddenAsTombstone: true })) {
      lastMessages.set(record.conversation_id, record);
    }
  }

  return rows.map((r) => {
    const last = lastMessages.get(r.id);
    return {
      id: r.id,
      type: r.type,
      is_saved: r.saved_for !== null,
      title: r.type === 'group' ? r.name : null,
      avatar_url: mediaUrl(config, r.avatar_object_key),
      description: r.type === 'group' ? r.description : null,
      peer: peers.get(r.id) ?? null,
      member_count: memberCount.get(r.id) ?? 0,
      my_role: r.role,
      last_seq: r.last_seq,
      read_seq: r.read_seq,
      unread_count: Math.max(0, Number(r.unread_count)),
      last_message: last ?? null,
      created_at: r.created_at.toISOString(),
      settings: {
        only_admins_send: r.admin_only_send,
        only_admins_edit_info: r.admin_only_edit,
        approval_required: r.approval_required,
        disappearing_timer_s: r.disappearing_seconds ?? 0,
      },
      prefs: toPrefs(r),
    };
  });
}

export function toPrefs(r: {
  archived: boolean;
  pinned_at: Date | null;
  favourite: boolean;
  muted_until: Date | null;
  lock_hash: string | null;
  wallpaper: string | null;
}): ChatPrefs {
  return {
    archived: r.archived,
    pinned: r.pinned_at !== null,
    favorite: r.favourite,
    muted_until: r.muted_until?.toISOString() ?? null,
    locked: r.lock_hash !== null,
    lock_hash: r.lock_hash,
    wallpaper: r.wallpaper,
  };
}

// ------------------------------------------------------------------ members

/** Members A to Z by username; the cursor is the last username of the previous page. */
export async function listMembers(
  db: Db,
  config: Config,
  conversationId: string,
  query: { cursor?: string; limit: number },
) {
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await db
    .selectFrom('conversation_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .select([...USER_COLUMNS, 'cm.role', 'cm.joined_at'])
    .where('cm.conversation_id', '=', conversationId)
    .where('cm.left_at', 'is', null)
    .$if(after !== null, (qb) => qb.where('u.username', '>', after!))
    .orderBy('u.username')
    .limit(query.limit + 1)
    .execute();
  const page = rows.slice(0, query.limit);
  return {
    items: page.map((r) => memberDto(config, r)),
    next_cursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!.username) : null,
  };
}

export function memberDto(
  config: Config,
  r: Parameters<typeof toUserSummary>[1] & {
    role: ConversationSummary['my_role'];
    joined_at: Date;
  },
) {
  return { user: toUserSummary(config, r), role: r.role, joined_at: r.joined_at.toISOString() };
}

export async function getMember(db: Db, config: Config, conversationId: string, userId: string) {
  const row = await db
    .selectFrom('conversation_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .select([...USER_COLUMNS, 'cm.role', 'cm.joined_at'])
    .where('cm.conversation_id', '=', conversationId)
    .where('cm.user_id', '=', userId)
    .where('cm.left_at', 'is', null)
    .executeTakeFirst();
  return row ? memberDto(config, row) : undefined;
}

/** Active members whose username or display name starts with `q`, for the @mention picker. */
export async function mentionCandidates(
  db: Db,
  config: Config,
  conversationId: string,
  userId: string,
  query: { q: string; limit: number },
): Promise<UserSummary[]> {
  // % and _ typed by the user must not act as wildcards.
  const prefix = `${query.q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await db
    .selectFrom('conversation_members as cm')
    .innerJoin('users as u', 'u.id', 'cm.user_id')
    .select(USER_COLUMNS)
    .where('cm.conversation_id', '=', conversationId)
    .where('cm.left_at', 'is', null)
    .where('cm.user_id', '!=', userId)
    .where((eb) =>
      eb.or([eb('u.username', 'ilike', prefix), eb('u.display_name', 'ilike', prefix)]),
    )
    .orderBy('u.username')
    .limit(query.limit)
    .execute();
  const candidates = rows.map((r) => toUserSummary(config, r));

  // Anyone can mention the AI assistant, even though it is not a member of the chat.
  if ('flick'.startsWith(query.q.toLowerCase()) && candidates.length < query.limit) {
    const bot = await db
      .selectFrom('users as u')
      .select(USER_COLUMNS)
      .where('u.id', '=', FLICK_BOT_USER_ID)
      .executeTakeFirst();
    if (bot && !candidates.some((c) => c.id === bot.id))
      candidates.unshift(toUserSummary(config, bot));
  }
  return candidates;
}
