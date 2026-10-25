import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { Database, Message, MessageType } from '../types.js';
import { DbError } from './errors.js';

export type MessageRow = Omit<Message, 'search'>;

// Every message column except the generated tsvector.
export const MESSAGE_COLUMNS = [
  'id',
  'conversation_id',
  'seq',
  'sender_id',
  'sender_device_id',
  'client_message_id',
  'type',
  'body_text',
  'content',
  'attachment_id',
  'reply_to_id',
  'forwarded',
  'view_once',
  'viewed_at',
  'expire_at',
  'mentions',
  'is_legacy',
  'edited_at',
  'deleted_at',
  'created_at',
] as const;

export const MESSAGE_TOPIC = 'chat.message.v1';

export interface SendMessageInput {
  conversationId: string;
  // null for server-written system messages.
  senderId: string | null;
  senderDeviceId: string | null;
  clientMessageId: string | null;
  type: MessageType;
  bodyText?: string | null;
  content?: Record<string, unknown> | null;
  // Must be an upload owned by the sender.
  attachmentId?: string | null;
  replyToId?: string | null;
  forwarded?: boolean;
  viewOnce?: boolean;
  mentions?: string[];
  // Checks that the sender is an active member allowed to post. Only server-written system
  // messages (e.g. "Alice added Bob") turn this off.
  authorize?: boolean;
}

export interface SendMessageResult {
  message: MessageRow;
  // True when this was a retry of a message that was already accepted; nothing new was written.
  duplicate: boolean;
}

// Thrown inside the transaction to roll it back when the message already exists.
class Duplicate extends Error {}

// Accepts a message. Everything happens in ONE transaction, and the caller acks the client
// only after this resolves (i.e. after COMMIT):
//   1. UPDATE conversations SET last_seq = last_seq + 1 ... RETURNING last_seq
//      (locks this conversation's row, so concurrent sends get consecutive seqs);
//   2. INSERT the message ... ON CONFLICT (sender_device_id, client_message_id) DO NOTHING;
//   3. if nothing was inserted it is a retry: ROLLBACK, which also undoes the seq increment so
//      no gap is left, then return the original message with duplicate = true;
//   4. otherwise check permissions and the attachment, write the outbox event, and COMMIT.
//
// When `db` is already a transaction, the message joins it instead of opening its own, so a
// caller can commit a membership change and its system message together. A duplicate cannot
// be undone on its own there (it throws and the caller's transaction rolls back), which is
// fine because system messages have no client_message_id and are never duplicates.
export async function allocateSeqAndInsertMessage(
  db: Kysely<Database>,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  try {
    const run = async (trx: Kysely<Database>) => {
      const conversation = await trx
        .updateTable('conversations')
        .set((eb) => ({ last_seq: eb('last_seq', '+', 1), last_message_at: sql<Date>`now()` }))
        .where('id', '=', input.conversationId)
        .returning(['last_seq', 'disappearing_seconds', 'admin_only_send'])
        .executeTakeFirst();
      if (!conversation) throw new DbError('conversation_not_found', 'conversation does not exist');

      const timer = conversation.disappearing_seconds;
      const inserted = await trx
        .insertInto('messages')
        .values({
          conversation_id: input.conversationId,
          seq: conversation.last_seq,
          sender_id: input.senderId,
          sender_device_id: input.senderDeviceId,
          client_message_id: input.clientMessageId,
          type: input.type,
          body_text: input.bodyText ?? null,
          content: input.content ?? null,
          attachment_id: input.attachmentId ?? null,
          reply_to_id: input.replyToId ?? null,
          forwarded: input.forwarded ?? false,
          view_once: input.viewOnce ?? false,
          mentions: input.mentions ?? [],
          expire_at: timer ? sql<Date>`now() + make_interval(secs => ${timer})` : null,
        })
        .onConflict((oc) => oc.columns(['sender_device_id', 'client_message_id']).doNothing())
        .returning(MESSAGE_COLUMNS)
        .executeTakeFirst();
      if (!inserted) throw new Duplicate();

      if (input.authorize !== false) {
        const member = await trx
          .selectFrom('conversation_members')
          .select('role')
          .where('conversation_id', '=', input.conversationId)
          .where('user_id', '=', input.senderId)
          .where('left_at', 'is', null)
          .executeTakeFirst();
        if (!member)
          throw new DbError('not_a_member', 'sender is not a member of the conversation');
        if (conversation.admin_only_send && member.role === 'member') {
          throw new DbError('not_allowed', 'only admins can send messages in this group');
        }
      }

      if (input.attachmentId) {
        // The sender's own upload, or one already in a chat the sender is in: that is what
        // forwarding a photo, voice note or file received from someone else sends.
        const attachment = await trx
          .updateTable('attachments')
          .set({ status: 'attached' })
          .where('id', '=', input.attachmentId)
          .where((eb) =>
            eb.or([
              eb('owner_id', '=', input.senderId),
              eb.exists(
                eb
                  .selectFrom('messages as src')
                  .innerJoin(
                    'conversation_members as cm',
                    'cm.conversation_id',
                    'src.conversation_id',
                  )
                  .select('src.id')
                  .whereRef('src.attachment_id', '=', 'attachments.id')
                  .where('src.id', '!=', inserted.id) // not the message being sent right now
                  .where('src.deleted_at', 'is', null)
                  .where('cm.user_id', '=', input.senderId)
                  .where('cm.left_at', 'is', null),
              ),
            ]),
          )
          .where('status', 'in', ['uploaded', 'attached'])
          .returning('id')
          .executeTakeFirst();
        if (!attachment)
          throw new DbError('attachment_not_found', 'attachment is not an upload of the sender');
      }

      await trx
        .insertInto('outbox')
        .values({
          event_id: randomUUID(),
          topic: MESSAGE_TOPIC,
          partition_key: input.conversationId,
          payload: {
            type: 'message.created',
            conversation_id: inserted.conversation_id,
            message_id: inserted.id,
            seq: inserted.seq,
            sender_id: inserted.sender_id,
            sender_device_id: inserted.sender_device_id,
            mentions: inserted.mentions,
          },
        })
        .execute();

      return inserted;
    };
    const message = db.isTransaction ? await run(db) : await db.transaction().execute(run);
    return { message, duplicate: false };
  } catch (err) {
    if (!(err instanceof Duplicate) || db.isTransaction) throw err;
  }

  // The transaction rolled back. The conflicting row must be committed (the unique index made
  // us wait for it), so this read finds it. (A retry always has a sender device and client id.)
  const existing = await db
    .selectFrom('messages')
    .select(MESSAGE_COLUMNS)
    .where('sender_device_id', '=', input.senderDeviceId!)
    .where('client_message_id', '=', input.clientMessageId!)
    .executeTakeFirstOrThrow();
  if (existing.conversation_id !== input.conversationId) {
    throw new DbError(
      'idempotency_conflict',
      'client_message_id was already used for another conversation',
    );
  }
  return { message: existing, duplicate: true };
}

export interface HistoryInput {
  conversationId: string;
  // 'backward': older messages, newest first (scrolling up); cursor = exclusive upper bound.
  // 'forward': newer messages, oldest first (sync after reconnect); cursor = exclusive lower bound.
  direction: 'backward' | 'forward';
  cursor?: number | null;
  limit?: number;
  // When set, rows this user must not see are left out: expired disappearing messages and
  // messages the user deleted "for me".
  viewerId?: string;
}

export const HISTORY_MAX_LIMIT = 200;

// SQL condition: the message has not expired and the user has not hidden it ("delete for me").
// Expired rows stay in the table until the worker's cleanup runs, so reads must filter them.
export function visibleTo(userId: string) {
  return sql<boolean>`(messages.expire_at IS NULL OR messages.expire_at > now())
    AND NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.message_id = messages.id AND h.user_id = ${userId})`;
}

// Keyset pagination on (conversation_id, seq). It never uses OFFSET, so page 1,000 costs the
// same as page 1, and new messages arriving during sync cannot shift or duplicate rows.
// Deleted messages are returned as tombstones so every device learns about the delete.
export function buildHistoryQuery(db: Kysely<Database>, input: HistoryInput, limit: number) {
  const backward = input.direction === 'backward';
  let q = db
    .selectFrom('messages')
    .select(MESSAGE_COLUMNS)
    .where('conversation_id', '=', input.conversationId);
  if (backward && input.cursor != null) q = q.where('seq', '<', input.cursor);
  if (!backward) q = q.where('seq', '>', input.cursor ?? 0);
  if (input.viewerId) q = q.where(visibleTo(input.viewerId));
  return q.orderBy('seq', backward ? 'desc' : 'asc').limit(limit + 1);
}

export async function keysetHistory(
  db: Kysely<Database>,
  input: HistoryInput,
): Promise<{ messages: MessageRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), HISTORY_MAX_LIMIT);
  // One extra row tells us whether another page exists, without a COUNT.
  const rows = await buildHistoryQuery(db, input, limit).execute();
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1]!.seq : null;
  return { messages: page, nextCursor };
}

/**
 * "tha you" becomes "'tha':* & 'you':*": every word matches by its beginning, and a word marked
 * "-word" is excluded as a whole word. Only letters and digits are kept, so the text cannot change
 * the query. Null when no searchable word is left.
 */
export function prefixTsQuery(query: string): string | null {
  const WORD = /[\p{L}\p{N}_]+/gu;
  const excluded = [...query.matchAll(/(?:^|\s)-([\p{L}\p{N}_]+)/gu)].map((m) => m[1] ?? '');
  const words = query.replace(/(?:^|\s)-[\p{L}\p{N}_]+/gu, ' ').match(WORD);
  if (!words?.length) return null;
  return [...words.map((w) => `'${w}':*`), ...excluded.map((w) => `!'${w}'`)].join(' & ');
}

export interface SearchOptions {
  conversationId?: string;
  // Position of the last hit of the previous page. `createdAtText` is the exact value returned
  // in `created_at_text`; a JS Date would lose the microseconds and skip or repeat rows.
  after?: { createdAtText: string; id: string };
}

// Full-text search over message text, restricted to conversations the user is currently in.
// Expired and "deleted for me" messages are not returned. `snippet` is the matched text with
// the hits wrapped in U+0001 / U+0002; the caller escapes the text and turns those into markup.
export async function searchMessages(
  db: Kysely<Database>,
  userId: string,
  query: string,
  limit = 20,
  options: SearchOptions = {},
) {
  // Whole words as before (quotes, "or" and "-word" still work), plus the start of a word: typing
  // "tha" finds "thank". The two are OR-ed, so everything the old search found is still found.
  const prefix = prefixTsQuery(query);
  const tsquery = prefix
    ? sql`(websearch_to_tsquery('simple', ${query}) || to_tsquery('simple', ${prefix}))`
    : sql`websearch_to_tsquery('simple', ${query})`;
  let q = db
    .selectFrom('messages')
    .innerJoin('conversation_members as cm', 'cm.conversation_id', 'messages.conversation_id')
    .select([
      'messages.id',
      'messages.conversation_id',
      'messages.seq',
      'messages.sender_id',
      'messages.body_text',
      'messages.created_at',
      sql<string>`messages.created_at::text`.as('created_at_text'),
      sql<string>`ts_headline('simple', coalesce(messages.body_text, ''), ${tsquery},
        'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=1, MaxWords=25, MinWords=8')`.as(
        'snippet',
      ),
    ])
    .where('cm.user_id', '=', userId)
    .where('cm.left_at', 'is', null)
    .where('messages.deleted_at', 'is', null)
    .where(sql<boolean>`messages.search @@ ${tsquery}`)
    .where(visibleTo(userId));
  if (options.conversationId) q = q.where('messages.conversation_id', '=', options.conversationId);
  if (options.after) {
    q = q.where(
      sql<boolean>`(messages.created_at, messages.id) < (${options.after.createdAtText}::timestamptz, ${options.after.id}::uuid)`,
    );
  }
  return q
    .orderBy('messages.created_at', 'desc')
    .orderBy('messages.id', 'desc')
    .limit(Math.min(limit, 100))
    .execute();
}
