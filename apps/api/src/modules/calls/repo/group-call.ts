import { allocateSeqAndInsertMessage, type CallType } from '@chat/db';
import { sql } from 'kysely';
import type { Config } from '../../../config.js';
import type { Db } from '../../../db.js';
import { hasGroupFeatures } from '../../conversations/domain/roles.js';
import { ApiError } from '../../conversations/http/errors.js';
import { lockConversation, requireActiveMember } from '../../conversations/repo/core.js';
import { hashInviteCode } from '../../conversations/domain/invite-code.js';
import { livekitSettings, signLivekitToken, type SignToken } from '../domain/livekit.js';

// LiveKit tells us nothing about who is in a room unless we call it, so "a call is already
// running" is approximated: a "started" message in the last hour means someone already announced.
const ANNOUNCE_WINDOW = sql`interval '1 hour'`;

const invalidLink = () => new ApiError('INVITE_INVALID', 'This call link is not valid');

/**
 * An active member starts or joins the group's call. The "started a group call" message and the
 * token are made in one transaction: if signing fails, the message is rolled back too, so the
 * chat never announces a call nobody could join.
 */
export async function joinGroupCall(
  db: Db,
  config: Config,
  userId: string,
  conversationId: string,
  media: CallType,
  sign: SignToken = signLivekitToken,
) {
  const settings = livekitSettings(config); // 501 before any database work
  return db.transaction().execute(async (trx) => {
    const conv = await lockConversation(trx, conversationId);
    await requireActiveMember(trx, conversationId, userId);
    if (!hasGroupFeatures(conv.type)) {
      throw new ApiError('VALIDATION_FAILED', 'Group calls are for groups; use a 1:1 call here');
    }

    const recent = await trx
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', conversationId)
      .where('type', '=', 'call_event')
      .where(sql<boolean>`created_at > now() - ${ANNOUNCE_WINDOW}`)
      .limit(1)
      .executeTakeFirst();
    if (!recent) {
      await allocateSeqAndInsertMessage(trx, {
        conversationId,
        senderId: userId,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'call_event',
        content: {
          type: 'call_event',
          call_id: conversationId,
          media,
          outcome: 'started',
          group: true,
          started_at: new Date().toISOString(),
          duration_s: 0,
        },
        authorize: false,
      });
    }

    const issued = await sign(settings, userId, conversationId);
    return { call_id: conversationId, ...issued };
  });
}

/**
 * Join the call behind a link. The caller does NOT become a member of the conversation: the token
 * is for the call room only. Each token issued counts as one use; the count is bumped by a single
 * UPDATE with the limits in its WHERE, so two people cannot take the last use together.
 */
export async function joinByCallLink(
  db: Db,
  config: Config,
  userId: string,
  code: string,
  sign: SignToken = signLivekitToken,
) {
  const settings = livekitSettings(config);
  return db.transaction().execute(async (trx) => {
    const link = await trx
      .updateTable('call_links')
      .set((eb) => ({ use_count: eb('use_count', '+', 1) }))
      .where('token_hash', '=', hashInviteCode(code))
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .where(sql<boolean>`(max_uses IS NULL OR use_count < max_uses)`)
      .returning('conversation_id')
      .executeTakeFirst();
    if (!link) throw invalidLink();

    const issued = await sign(settings, userId, link.conversation_id);
    return { call_id: link.conversation_id, ...issued };
  });
}
