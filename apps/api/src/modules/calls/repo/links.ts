import type { CallLink } from '@chat/contracts';
import type { CallType } from '@chat/db';
import { sql } from 'kysely';
import type { z } from 'zod';
import type { Db } from '../../../db.js';
import { hashInviteCode, newInviteCode } from '../../conversations/domain/invite-code.js';
import { canManageMembers, hasGroupFeatures } from '../../conversations/domain/roles.js';
import { ApiError, forbidden } from '../../conversations/http/errors.js';
import { requireActiveMember } from '../../conversations/repo/core.js';

type Link = z.infer<typeof CallLink>;

const invalidLink = () => new ApiError('INVITE_INVALID', 'This call link is not valid');

/** Only a group admin can make a link. The raw code is returned once; only its hash is stored. */
export async function createCallLink(
  db: Db,
  actorId: string,
  input: { conversationId: string; media: CallType; expiresInS: number; maxUses?: number },
): Promise<Link> {
  const actor = await requireActiveMember(db, input.conversationId, actorId);
  const conv = await db
    .selectFrom('conversations')
    .select('type')
    .where('id', '=', input.conversationId)
    .executeTakeFirstOrThrow();
  if (!hasGroupFeatures(conv.type)) throw forbidden('Direct chats have no call links');
  if (!canManageMembers(actor.role)) throw forbidden('Only admins can create call links');

  const code = newInviteCode();
  const expiresAt = new Date(Date.now() + input.expiresInS * 1000);
  await db
    .insertInto('call_links')
    .values({
      conversation_id: input.conversationId,
      created_by: actorId,
      token_hash: hashInviteCode(code),
      media: input.media,
      expires_at: expiresAt,
      max_uses: input.maxUses ?? null,
    })
    .execute();
  return {
    code,
    conversation_id: input.conversationId,
    media: input.media,
    created_by: actorId,
    expires_at: expiresAt.toISOString(),
  };
}

/** Looks a link up without using it: what the "join call" page shows before the user joins. */
export async function getCallLink(db: Db, code: string): Promise<Link> {
  const row = await db
    .selectFrom('call_links')
    .select(['conversation_id', 'media', 'created_by', 'expires_at'])
    .where('token_hash', '=', hashInviteCode(code))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .where(sql<boolean>`(max_uses IS NULL OR use_count < max_uses)`)
    .executeTakeFirst();
  if (!row) throw invalidLink();
  return {
    code,
    conversation_id: row.conversation_id,
    media: row.media,
    created_by: row.created_by,
    expires_at: row.expires_at.toISOString(),
  };
}

/** Only the creator can revoke; anyone else gets the same answer as for an unknown link. */
export async function revokeCallLink(db: Db, actorId: string, code: string): Promise<void> {
  const revoked = await db
    .updateTable('call_links')
    .set({ revoked_at: new Date() })
    .where('token_hash', '=', hashInviteCode(code))
    .where('created_by', '=', actorId)
    .returning('id')
    .executeTakeFirst();
  if (!revoked) throw invalidLink();
}
