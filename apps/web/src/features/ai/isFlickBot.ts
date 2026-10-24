import { FLICK_BOT_USER_ID, type UserSummary } from '@chat/contracts';

/** True for messages written by the Flick AI bot. */
export const isFlickBot = (senderId: string | null, sender: UserSummary | null): boolean =>
  senderId === FLICK_BOT_USER_ID || sender?.is_bot === true;
