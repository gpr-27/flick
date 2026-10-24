import { FLICK_BOT_USER_ID, type ConversationSummary, type UserSummary } from '@chat/contracts';

/** True for messages written by the Flick AI bot. */
export const isFlickBot = (senderId: string | null, sender: UserSummary | null): boolean =>
  senderId === FLICK_BOT_USER_ID || sender?.is_bot === true;

/** True for the direct chat with the Flick bot. */
export const isFlickChat = (c: Pick<ConversationSummary, 'type' | 'peer'>): boolean =>
  c.type === 'direct' && (c.peer?.id === FLICK_BOT_USER_ID || c.peer?.is_bot === true);
