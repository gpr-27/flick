import { visibleTo } from '@chat/db';
import { sql } from 'kysely';
import type { Db } from '../../db.js';

// Chat text sent to the AI is always read here, from Postgres, for ONE requesting user: they must
// be an active member, and they only get what they could read themselves in the app (no expired
// or "deleted for me" messages, nothing from before they joined). A client never supplies it.

export interface ChatLine {
  sender: string;
  text: string;
  sentAt: string;
  fromMe: boolean;
}

export interface Membership {
  readSeq: number;
  joinedAt: Date;
}

/** The user's active membership, or undefined (not a member, left, or no such conversation). */
export async function getMembership(
  db: Db,
  conversationId: string,
  userId: string,
): Promise<Membership | undefined> {
  const row = await db
    .selectFrom('conversation_members')
    .select(['read_seq', 'joined_at'])
    .where('conversation_id', '=', conversationId)
    .where('user_id', '=', userId)
    .where('left_at', 'is', null)
    .executeTakeFirst();
  return row && { readSeq: row.read_seq, joinedAt: row.joined_at };
}

export interface LineLimits {
  /** Newest N messages to look at. */
  messages: number;
  /** Each message is cut to this many characters. */
  perMessageChars: number;
  /** Stop adding older messages once the text reaches this many characters. */
  totalChars: number;
  /** Only messages with a higher seq (the unread ones). */
  afterSeq?: number;
  /** Leave out the user's own messages. */
  skipOwn?: boolean;
}

/** The newest text messages the user can see, oldest first, within the size limits. */
export async function loadLines(
  db: Db,
  userId: string,
  conversationId: string,
  membership: Membership,
  limits: LineLimits,
): Promise<ChatLine[]> {
  let q = db
    .selectFrom('messages')
    .leftJoin('users', 'users.id', 'messages.sender_id')
    .select([
      'messages.sender_id',
      'messages.body_text',
      'messages.created_at',
      'users.display_name',
    ])
    .where('messages.conversation_id', '=', conversationId)
    .where('messages.deleted_at', 'is', null)
    .where('messages.body_text', 'is not', null)
    .where('messages.type', 'not in', ['system', 'call_event'])
    .where('messages.created_at', '>=', membership.joinedAt)
    .where(visibleTo(userId))
    .orderBy('messages.seq', 'desc')
    .limit(limits.messages);
  if (limits.afterSeq !== undefined) q = q.where('messages.seq', '>', limits.afterSeq);
  if (limits.skipOwn) q = q.where(sql<boolean>`messages.sender_id IS DISTINCT FROM ${userId}`);

  const lines: ChatLine[] = [];
  let total = 0;
  for (const row of await q.execute()) {
    const text = row.body_text!.trim().slice(0, limits.perMessageChars);
    if (!text) continue;
    if (total + text.length > limits.totalChars) break;
    total += text.length;
    lines.push({
      sender: (row.display_name?.trim() || 'Someone').slice(0, 100),
      text,
      sentAt: row.created_at.toISOString(),
      fromMe: row.sender_id === userId,
    });
  }
  return lines.reverse();
}

/** Chat text goes inside <messages> tags; remove any tag a sender typed so it cannot close the block. */
export function stripTags(text: string): string {
  return text.replace(/<\/?\s*messages\s*>/gi, '');
}

export function transcript(lines: ChatLine[]): string {
  return lines.map((l) => `${stripTags(l.sender)}: ${stripTags(l.text)}`).join('\n');
}
