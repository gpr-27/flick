import type { CallLogEntry } from '@chat/contracts';
import { allocateSeqAndInsertMessage, type CallStatus, type CallType } from '@chat/db';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { Db } from '../../../db.js';
import { ApiError } from '../../conversations/http/errors.js';
import { decodeCursor, encodeCursor } from '../../conversations/repo/cursor.js';

export interface RecordCallInput {
  /** The id the caller put in call_offer, so a retry cannot log the call twice. */
  callId: string;
  /** The direct conversation of the two users. */
  conversationId: string;
  callerId: string;
  media: CallType;
  outcome: Exclude<CallStatus, 'ringing' | 'ongoing'>;
  startedAt: Date;
  /** When the callee picked up; null if they never did. */
  answeredAt: Date | null;
  endedAt: Date;
}

const CONTENT_OUTCOME = { missed: 'missed', rejected: 'declined', completed: 'ended' } as const;

const durationSeconds = (answeredAt: Date | null, endedAt: Date | null) =>
  answeredAt && endedAt
    ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000))
    : 0;

/**
 * Called by the gateway when a 1:1 call ends. In ONE transaction it writes the call_logs row and
 * a call_event message, so the call shows up in the calls tab and in the chat together. A second
 * call with the same callId does nothing, which makes it safe to retry.
 */
export async function recordCall(db: Db, input: RecordCallInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('call_logs')
      .values({
        id: input.callId,
        conversation_id: input.conversationId,
        caller_id: input.callerId,
        type: input.media,
        status: input.outcome,
        started_at: input.startedAt,
        answered_at: input.answeredAt,
        ended_at: input.endedAt,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return;

    await allocateSeqAndInsertMessage(trx, {
      conversationId: input.conversationId,
      senderId: input.callerId,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'call_event',
      content: {
        type: 'call_event',
        call_id: input.callId,
        media: input.media,
        outcome: CONTENT_OUTCOME[input.outcome],
        started_at: input.startedAt.toISOString(),
        duration_s: durationSeconds(input.answeredAt, input.endedAt),
      },
      authorize: false,
    });
  });
}

type Entry = z.infer<typeof CallLogEntry>;

/**
 * The user's calls, newest first. A call is visible only to people who are active members of its
 * conversation; for a 1:1 call those are exactly the two users. The cursor is "started_at|id" of
 * the last row (started_at as text keeps microseconds that a JS Date would round off).
 */
export async function listCalls(
  db: Db,
  userId: string,
  query: { cursor?: string; limit: number },
): Promise<{ items: Entry[]; next_cursor: string | null }> {
  const after = query.cursor ? decodeCursor(query.cursor).split('|') : null;
  if (after && after.length !== 2) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');

  const rows = await db
    .selectFrom('call_logs as cl')
    .innerJoin('conversation_members as cm', (join) =>
      join.onRef('cm.conversation_id', '=', 'cl.conversation_id').on('cm.user_id', '=', userId),
    )
    .innerJoin('conversations as c', 'c.id', 'cl.conversation_id')
    .select([
      'cl.id',
      'cl.conversation_id',
      'cl.caller_id',
      'cl.type',
      'cl.status',
      'cl.started_at',
      'cl.answered_at',
      'cl.ended_at',
      'c.type as conversation_type',
      sql<string>`cl.started_at::text`.as('started_text'),
    ])
    .where('cm.left_at', 'is', null)
    .$if(after !== null, (qb) =>
      qb.where(
        sql<boolean>`(cl.started_at, cl.id) < (${after![0]}::timestamptz, ${after![1]}::uuid)`,
      ),
    )
    .orderBy('cl.started_at', 'desc')
    .orderBy('cl.id', 'desc')
    .limit(query.limit + 1)
    .execute();
  const page = rows.slice(0, query.limit);

  const members = page.length
    ? await db
        .selectFrom('conversation_members')
        .select(['conversation_id', 'user_id'])
        .where('conversation_id', 'in', [...new Set(page.map((r) => r.conversation_id))])
        .where('left_at', 'is', null)
        .execute()
    : [];

  const outcome = (status: CallStatus): Entry['outcome'] =>
    status === 'rejected' ? 'declined' : status === 'completed' ? 'ended' : 'missed';

  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      call_id: r.id,
      conversation_id: r.conversation_id,
      media: r.type,
      group: r.conversation_type === 'group',
      direction: r.caller_id === userId ? 'outgoing' : 'incoming',
      outcome: outcome(r.status),
      started_at: r.started_at.toISOString(),
      duration_s: durationSeconds(r.answered_at, r.ended_at),
      participant_ids: members
        .filter((m) => m.conversation_id === r.conversation_id)
        .map((m) => m.user_id),
    })),
    next_cursor:
      rows.length > query.limit && last ? encodeCursor(`${last.started_text}|${last.id}`) : null,
  };
}
