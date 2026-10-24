import { TOPICS, tickState, type MessageInfo } from '@chat/contracts';
import { advanceCursor, advanceReadSeq, recipientCursors } from '@chat/db';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import type { AuthContext } from '../../../auth-guard.js';
import type { Database } from '../../../db.js';
import { ApiError, toApiError } from '../errors.js';
import type { MessageDeps } from '../deps.js';
import { loadMessage, requireMember } from '../repo/access.js';

async function writeReceiptEvent(
  trx: Kysely<Database>,
  conversationId: string,
  payload: Record<string, unknown>,
) {
  await trx
    .insertInto('outbox')
    .values({
      topic: TOPICS.RECEIPT,
      partition_key: conversationId,
      payload: { conversation_id: conversationId, ...payload },
    })
    .execute();
}

/**
 * "This device has stored everything up to seq" (delivery_ack). Moves the DEVICE's
 * delivered_seq forward, never back, and never past the conversation's last_seq. A
 * chat.receipt.v1 event is written only when the cursor really moved, so repeated acks
 * do not flood the broker. Acks for conversations the user has left are ignored.
 */
export async function acknowledgeDelivered(
  deps: MessageDeps,
  auth: AuthContext,
  acks: { conversationId: string; seq: number }[],
): Promise<void> {
  if (acks.length === 0) return;
  const memberOf = await deps.db
    .selectFrom('conversation_members')
    .select('conversation_id')
    .where('user_id', '=', auth.userId)
    .where('left_at', 'is', null)
    .where(
      'conversation_id',
      'in',
      acks.map((a) => a.conversationId),
    )
    .execute();
  const allowed = new Set(memberOf.map((m) => m.conversation_id));

  await deps.db.transaction().execute(async (trx) => {
    for (const ack of acks.filter((a) => allowed.has(a.conversationId))) {
      const before = await trx
        .selectFrom('device_cursors')
        .select('delivered_seq')
        .where('device_id', '=', auth.deviceId)
        .where('conversation_id', '=', ack.conversationId)
        .executeTakeFirst();
      const after = await advanceCursor(trx, {
        deviceId: auth.deviceId,
        conversationId: ack.conversationId,
        deliveredSeq: ack.seq,
      });
      if (after.deliveredSeq > (before?.delivered_seq ?? 0)) {
        await writeReceiptEvent(trx, ack.conversationId, {
          type: 'receipt.delivered',
          user_id: auth.userId,
          device_id: auth.deviceId,
          delivered_seq: after.deliveredSeq,
        });
      }
    }
  });
}

/**
 * "The user has read up to seq" (read_ack). Moves the USER's read_seq forward, never back,
 * capped at last_seq. Returns the stored read_seq.
 */
export async function acknowledgeRead(
  deps: MessageDeps,
  auth: AuthContext,
  input: { conversationId: string; seq: number },
): Promise<{ readSeq: number }> {
  try {
    return await deps.db.transaction().execute(async (trx) => {
      const member = await requireMember(trx, input.conversationId, auth.userId);
      const readSeq = await advanceReadSeq(trx, {
        conversationId: input.conversationId,
        userId: auth.userId,
        readSeq: input.seq,
      });
      if (readSeq > member.read_seq) {
        await writeReceiptEvent(trx, input.conversationId, {
          type: 'receipt.read',
          user_id: auth.userId,
          read_seq: readSeq,
        });
      }
      return { readSeq };
    });
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * "Message info" for the sender: for each other member, whether they have received and read
 * this message. Computed from the cursors, not stored per message.
 */
export async function getMessageInfo(
  deps: MessageDeps,
  auth: AuthContext,
  target: { conversationId: string; messageId: string },
): Promise<z.infer<typeof MessageInfo>> {
  await requireMember(deps.db, target.conversationId, auth.userId);
  const message = await loadMessage(deps.db, target.conversationId, target.messageId);
  if (message.sender_id !== auth.userId) {
    throw new ApiError('FORBIDDEN', 'Only the sender can see who received a message.');
  }
  const cursors = await recipientCursors(deps.db, target.conversationId, auth.userId);
  // "Read" is hidden when either side turned read receipts off.
  const off = await deps.db
    .selectFrom('user_settings')
    .select('user_id')
    .where('read_receipts', '=', false)
    .where('user_id', 'in', [auth.userId, ...cursors.map((c) => c.user_id)])
    .execute();
  const hidden = new Set(off.map((r) => r.user_id));
  return {
    message_id: message.id,
    recipients: cursors.map((c) => {
      const state = tickState(message.seq, [c]);
      const canSeeRead = !hidden.has(auth.userId) && !hidden.has(c.user_id);
      return {
        user_id: c.user_id,
        delivered: state !== 'sent',
        read: state === 'read' && canSeeRead,
      };
    }),
  };
}
