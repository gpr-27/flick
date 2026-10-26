import { sql, type Kysely } from 'kysely';

import type { Database, MessageType } from '../types.js';

// What a reminder says about its message and chat. Used by the API (the list) and the worker (the
// delivery), so both show the same thing. Nothing here is stored: it is read when needed, so a
// deleted, expired or hidden message never leaks through a reminder.

export interface ReminderTarget {
  user_id: string;
  conversation_id: string;
  message_id: string | null;
}

export interface ReminderContext {
  /** The chat's name as this person sees it. */
  chatName: string;
  /** Short text of the message; null for a chat reminder or when the message is gone. */
  quote: string | null;
  author: string | null;
  /** The reminder was about a message that is deleted, expired, hidden or no longer readable. */
  messageGone: boolean;
}

const QUOTE_LENGTH = 80;

const TYPE_LABEL: Record<MessageType, string> = {
  text: 'Message',
  image: 'Photo',
  file: 'File',
  voice: 'Voice message',
  video: 'Video',
  gif: 'GIF',
  sticker: 'Sticker',
  poll: 'Poll',
  system: 'Message',
  call_event: 'Call',
  checklist: 'Checklist',
  expense: 'Expense',
  game: 'Game',
  event: 'Event',
};

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= QUOTE_LENGTH ? flat : `${flat.slice(0, QUOTE_LENGTH - 1)}…`;
};

/** Looks up the chat name and the message quote for each target. Keys are `userId:conversationId:messageId`. */
export async function loadReminderContexts(
  db: Kysely<Database>,
  targets: ReminderTarget[],
): Promise<Map<string, ReminderContext>> {
  const result = new Map<string, ReminderContext>();
  if (targets.length === 0) return result;
  const conversationIds = [...new Set(targets.map((t) => t.conversation_id))];
  const userIds = [...new Set(targets.map((t) => t.user_id))];

  const [chats, members, found] = await Promise.all([
    db
      .selectFrom('conversations')
      .select(['id', 'type', 'name', 'saved_for'])
      .where('id', 'in', conversationIds)
      .execute(),
    // Everyone in these chats, to name direct chats after the other person and to check that
    // the reminder's owner is still a member.
    db
      .selectFrom('conversation_members as cm')
      .innerJoin('users as u', 'u.id', 'cm.user_id')
      .select(['cm.conversation_id', 'cm.user_id', 'cm.left_at', 'u.display_name'])
      .where('cm.conversation_id', 'in', conversationIds)
      .execute(),
    messageRows(db, targets, userIds),
  ]);

  const chatById = new Map(chats.map((c) => [c.id, c]));
  const messageById = new Map(found.rows.map((m) => [m.id, m]));
  for (const t of targets) {
    const chat = chatById.get(t.conversation_id);
    const own = members.find(
      (m) => m.conversation_id === t.conversation_id && m.user_id === t.user_id,
    );
    const other = members.find(
      (m) => m.conversation_id === t.conversation_id && m.user_id !== t.user_id,
    );
    const chatName =
      chat?.saved_for != null
        ? 'Saved messages'
        : chat?.type === 'direct'
          ? (other?.display_name ?? 'Chat')
          : (chat?.name ?? 'Group');

    let context: ReminderContext = { chatName, quote: null, author: null, messageGone: false };
    if (t.message_id) {
      const m = messageById.get(t.message_id);
      const hidden = found.hidden.has(`${t.user_id}:${t.message_id}`);
      const readable = m && !m.gone && !hidden && own && own.left_at === null;
      context = readable
        ? {
            chatName,
            quote: m.view_once ? 'View once message' : shorten(m.body_text ?? TYPE_LABEL[m.type]),
            author: m.author,
            messageGone: false,
          }
        : { chatName, quote: null, author: null, messageGone: true };
    }
    result.set(contextKey(t), context);
  }
  return result;
}

export const contextKey = (t: ReminderTarget): string =>
  `${t.user_id}:${t.conversation_id}:${t.message_id ?? ''}`;

async function messageRows(db: Kysely<Database>, targets: ReminderTarget[], userIds: string[]) {
  const messageIds = [...new Set(targets.flatMap((t) => (t.message_id ? [t.message_id] : [])))];
  if (messageIds.length === 0) return { rows: [], hidden: new Set<string>() };
  const rows = await db
    .selectFrom('messages as m')
    .leftJoin('users as sender', 'sender.id', 'm.sender_id')
    .select([
      'm.id',
      'm.type',
      'm.body_text',
      'm.view_once',
      'sender.display_name as author',
      sql<boolean>`(m.deleted_at IS NOT NULL OR (m.expire_at IS NOT NULL AND m.expire_at <= now()))`.as(
        'gone',
      ),
    ])
    .where('m.id', 'in', messageIds)
    .execute();
  // "Delete for me" is per person, so it is looked up for the people asking.
  const hiddenRows = await db
    .selectFrom('hidden_messages')
    .select(['message_id', 'user_id'])
    .where('message_id', 'in', messageIds)
    .where('user_id', 'in', userIds)
    .execute();
  return { rows, hidden: new Set(hiddenRows.map((h) => `${h.user_id}:${h.message_id}`)) };
}
