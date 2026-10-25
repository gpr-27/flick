import { randomUUID } from 'node:crypto';
import { ConversationEvent, TOPICS } from '@chat/contracts';
import type { Db } from '../../../db.js';

/** A person in more chats than this tells only the most recently active ones; the rest load fresh data. */
export const PROFILE_ANNOUNCE_MAX_CONVERSATIONS = 200;

/**
 * Tells everyone who shares a chat with `userId` that their name, username or picture changed.
 * One outbox row per conversation, written in the caller's transaction, so the change and the
 * announcement commit together. The dispatcher reads who is a member at delivery time.
 */
export async function announceProfileChange(trx: Db, userId: string): Promise<void> {
  const conversations = await trx
    .selectFrom('conversation_members as m')
    .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
    .select('c.id')
    .where('m.user_id', '=', userId)
    .where('m.left_at', 'is', null)
    .orderBy('c.last_message_at', (o) => o.desc().nullsLast())
    .orderBy('c.created_at', 'desc')
    .limit(PROFILE_ANNOUNCE_MAX_CONVERSATIONS)
    .execute();
  if (conversations.length === 0) return;
  const now = new Date().toISOString();
  await trx
    .insertInto('outbox')
    .values(
      conversations.map(({ id }) => {
        // Parsing here means a malformed event fails the transaction instead of reaching the outbox.
        const event = ConversationEvent.parse({
          event_id: randomUUID(),
          schema_version: 1,
          occurred_at: now,
          key: id,
          type: 'conversation.member_profile_changed',
          conversation_id: id,
          data: { user_id: userId },
        });
        return {
          event_id: event.event_id,
          topic: TOPICS.CONVERSATION,
          partition_key: id,
          payload: event,
        };
      }),
    )
    .execute();
}
