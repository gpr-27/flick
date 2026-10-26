import type { Db } from '../../db.js';
import type { Redis } from '../../redis.js';

// "Allow Flick to read this chat": on unless the user switched it off for that chat.

export const AI_OFF_MESSAGE = 'AI is turned off for this chat';

export class AiPrivacyError extends Error {
  constructor() {
    super(AI_OFF_MESSAGE);
    this.name = 'AiPrivacyError';
  }
}

export async function isAiAllowed(
  db: Db,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('ai_chat_privacy')
    .select('allow')
    .where('user_id', '=', userId)
    .where('conversation_id', '=', conversationId)
    .executeTakeFirst();
  return row?.allow ?? true;
}

export async function assertAiAllowed(
  db: Db,
  userId: string,
  conversationId: string,
): Promise<void> {
  if (!(await isAiAllowed(db, userId, conversationId))) throw new AiPrivacyError();
}

export async function setAiAllowed(
  db: Db,
  userId: string,
  conversationId: string,
  allow: boolean,
): Promise<void> {
  await db
    .insertInto('ai_chat_privacy')
    .values({ user_id: userId, conversation_id: conversationId, allow })
    .onConflict((oc) =>
      oc.columns(['user_id', 'conversation_id']).doUpdateSet({ allow, updated_at: new Date() }),
    )
    .execute();
}

/** 'fast' tries the quick providers first. Kept in Redis: it is only a preference. */
export type Speed = 'fast' | 'quality';
export async function getSpeed(redis: Redis, userId: string): Promise<Speed> {
  const v = await redis.get(`ai:speed:${userId}`).catch(() => null);
  return v === 'fast' ? 'fast' : 'quality';
}
export async function setSpeed(redis: Redis, userId: string, speed: Speed): Promise<void> {
  await redis.set(`ai:speed:${userId}`, speed);
}
