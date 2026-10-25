import { randomUUID } from 'node:crypto';
import { ConversationEvent, TOPICS, type MessageRecord } from '@chat/contracts';
import { MESSAGE_COLUMNS, visibleTo } from '@chat/db';
import { sql } from 'kysely';
import type { AuthContext } from '../../../auth-guard.js';
import type { Db } from '../../../db.js';
import { ApiError } from '../errors.js';
import type { MessageDeps } from '../deps.js';
import { loadMessage, requireMember } from '../repo/access.js';
import { decodeKeyset, encodeKeyset } from './keyset.js';
import { toRecords } from './records.js';

interface Target {
  conversationId: string;
  messageId: string;
}

// ------------------------------------------------------------------ pin / star

/** Tells every member's devices, through the outbox, that the pinned list changed. */
async function announcePinChange(
  trx: Db,
  conversationId: string,
  data: { actor_user_id: string; message_id: string; pinned: boolean },
): Promise<void> {
  // Parsing here means a malformed event fails the transaction instead of reaching the outbox.
  const event = ConversationEvent.parse({
    event_id: randomUUID(),
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    key: conversationId,
    type: 'conversation.pins_changed',
    conversation_id: conversationId,
    data,
  });
  await trx
    .insertInto('outbox')
    .values({
      event_id: event.event_id,
      topic: TOPICS.CONVERSATION,
      partition_key: conversationId,
      payload: event,
    })
    .execute();
}

/** Any member can pin. A pinned message is shown to everyone in the conversation. */
export async function pinMessage(deps: MessageDeps, auth: AuthContext, target: Target) {
  await requireMember(deps.db, target.conversationId, auth.userId);
  const message = await loadMessage(deps.db, target.conversationId, target.messageId);
  if (message.deleted_at) throw new ApiError('CONFLICT', 'This message was deleted.');
  await deps.db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('pinned_messages')
      .values({
        message_id: message.id,
        conversation_id: target.conversationId,
        pinned_by: auth.userId,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('message_id')
      .executeTakeFirst();
    // Pinning what is already pinned changes nothing, so nobody is told.
    if (inserted) {
      await announcePinChange(trx, target.conversationId, {
        actor_user_id: auth.userId,
        message_id: message.id,
        pinned: true,
      });
    }
  });
}

export async function unpinMessage(deps: MessageDeps, auth: AuthContext, target: Target) {
  await requireMember(deps.db, target.conversationId, auth.userId);
  await deps.db.transaction().execute(async (trx) => {
    const removed = await trx
      .deleteFrom('pinned_messages')
      .where('message_id', '=', target.messageId)
      .where('conversation_id', '=', target.conversationId)
      .returning('message_id')
      .executeTakeFirst();
    if (removed) {
      await announcePinChange(trx, target.conversationId, {
        actor_user_id: auth.userId,
        message_id: target.messageId,
        pinned: false,
      });
    }
  });
}

export async function listPins(
  deps: MessageDeps,
  auth: AuthContext,
  conversationId: string,
): Promise<{ items: MessageRecord[] }> {
  await requireMember(deps.db, conversationId, auth.userId);
  const rows = await deps.db
    .selectFrom('messages')
    .innerJoin('pinned_messages as p', 'p.message_id', 'messages.id')
    .select(MESSAGE_COLUMNS.map((c) => `messages.${c}` as const))
    .where('p.conversation_id', '=', conversationId)
    .where('messages.deleted_at', 'is', null)
    .where(visibleTo(auth.userId))
    .orderBy('p.pinned_at', 'desc')
    .execute();
  return { items: await toRecords(deps.db, auth.userId, rows) };
}

/** Stars are private to the caller. */
export async function starMessage(deps: MessageDeps, auth: AuthContext, target: Target) {
  await requireMember(deps.db, target.conversationId, auth.userId);
  const message = await loadMessage(deps.db, target.conversationId, target.messageId);
  await deps.db
    .insertInto('starred_messages')
    .values({ user_id: auth.userId, message_id: message.id })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export async function unstarMessage(deps: MessageDeps, auth: AuthContext, target: Target) {
  await requireMember(deps.db, target.conversationId, auth.userId);
  await deps.db
    .deleteFrom('starred_messages')
    .where('user_id', '=', auth.userId)
    .where('message_id', '=', target.messageId)
    .execute();
}

/** Starred messages across the caller's active conversations, most recently starred first. */
export async function listStarred(
  deps: MessageDeps,
  auth: AuthContext,
  query: { cursor?: string; limit: number },
): Promise<{ items: MessageRecord[]; next_cursor: string | null }> {
  const after = query.cursor ? decodeKeyset(query.cursor) : null;
  let q = deps.db
    .selectFrom('messages')
    .innerJoin('starred_messages as s', 's.message_id', 'messages.id')
    .innerJoin('conversation_members as cm', (join) =>
      join
        .onRef('cm.conversation_id', '=', 'messages.conversation_id')
        .on('cm.user_id', '=', auth.userId)
        .on('cm.left_at', 'is', null),
    )
    .select([
      ...MESSAGE_COLUMNS.map((c) => `messages.${c}` as const),
      sql<string>`s.starred_at::text`.as('starred_at_text'),
    ])
    .where('s.user_id', '=', auth.userId)
    .where(visibleTo(auth.userId));
  if (after) {
    q = q.where(
      sql<boolean>`(s.starred_at, messages.id) < (${after.at}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await q
    .orderBy('s.starred_at', 'desc')
    .orderBy('messages.id', 'desc')
    .limit(query.limit + 1)
    .execute();

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: await toRecords(deps.db, auth.userId, page),
    next_cursor:
      rows.length > query.limit && last ? encodeKeyset(last.starred_at_text, last.id) : null,
  };
}

// ------------------------------------------------------------------------- polls

export interface PollTally {
  message_id: string;
  question: string;
  allow_multiple: boolean;
  options: { index: number; text: string; voter_ids: string[] }[];
}

/**
 * Sets the caller's vote. The old vote is deleted and the new one inserted in one
 * transaction, so a poll never shows two votes from the same single-choice voter.
 * An empty list removes the vote. Counts are not stored; they are computed on read.
 */
export async function votePoll(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target & { optionIndexes: number[] },
): Promise<PollTally> {
  await deps.db.transaction().execute(async (trx) => {
    await requireMember(trx, target.conversationId, auth.userId);
    const poll = await loadMessage(trx, target.conversationId, target.messageId);
    if (poll.type !== 'poll' || poll.deleted_at) {
      throw new ApiError('NOT_FOUND', 'Poll not found.');
    }
    const content = poll.content as { options: string[]; allow_multiple: boolean };
    const indexes = [...new Set(target.optionIndexes)];
    if (indexes.some((i) => i >= content.options.length)) {
      throw new ApiError('VALIDATION_FAILED', 'That option does not exist.');
    }
    if (!content.allow_multiple && indexes.length > 1) {
      throw new ApiError('VALIDATION_FAILED', 'This poll allows one choice.');
    }
    await trx
      .deleteFrom('poll_votes')
      .where('message_id', '=', poll.id)
      .where('user_id', '=', auth.userId)
      .execute();
    if (indexes.length > 0) {
      await trx
        .insertInto('poll_votes')
        .values(
          indexes.map((i) => ({ message_id: poll.id, user_id: auth.userId, option_index: i })),
        )
        .execute();
    }
  });
  return getPollTally(deps, auth, target);
}

/** The tally is computed from poll_votes each time it is read. */
export async function getPollTally(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target,
): Promise<PollTally> {
  await requireMember(deps.db, target.conversationId, auth.userId);
  const poll = await loadMessage(deps.db, target.conversationId, target.messageId);
  if (poll.type !== 'poll' || poll.deleted_at) throw new ApiError('NOT_FOUND', 'Poll not found.');
  const content = poll.content as { options: string[]; allow_multiple: boolean };
  const votes = await deps.db
    .selectFrom('poll_votes')
    .select(['option_index', 'user_id'])
    .where('message_id', '=', poll.id)
    .orderBy('voted_at')
    .execute();
  return {
    message_id: poll.id,
    question: poll.body_text ?? '',
    allow_multiple: content.allow_multiple,
    options: content.options.map((text, index) => ({
      index,
      text,
      voter_ids: votes.filter((v) => v.option_index === index).map((v) => v.user_id),
    })),
  };
}

// --------------------------------------------------------------------- view once

/**
 * A recipient opened a view-once message. From now on it comes back to them without content.
 * Only the first open counts; opening again is an error.
 */
export async function openViewOnce(
  deps: MessageDeps,
  auth: AuthContext,
  target: Target,
): Promise<{ message_id: string; opened_at: string }> {
  return deps.db.transaction().execute(async (trx) => {
    await requireMember(trx, target.conversationId, auth.userId);
    const message = await loadMessage(trx, target.conversationId, target.messageId);
    if (!message.view_once || message.deleted_at) {
      throw new ApiError('NOT_FOUND', 'View-once message not found.');
    }
    if (message.sender_id === auth.userId) {
      throw new ApiError('FORBIDDEN', 'You cannot open your own view-once message.');
    }
    const opened = await trx
      .insertInto('view_once_opens')
      .values({ message_id: message.id, user_id: auth.userId })
      .onConflict((oc) => oc.doNothing())
      .returning('opened_at')
      .executeTakeFirst();
    if (!opened) {
      throw new ApiError('VIEW_ONCE_ALREADY_OPENED', 'You already opened this message.');
    }
    await trx
      .updateTable('messages')
      .set({ viewed_at: opened.opened_at })
      .where('id', '=', message.id)
      .where('viewed_at', 'is', null)
      .execute();
    return { message_id: message.id, opened_at: opened.opened_at.toISOString() };
  });
}
