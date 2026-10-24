import type { MessageRecord } from '@chat/contracts';

/** The server only knows a group call started, not that it ended, so it counts for an hour. */
export const GROUP_CALL_MAX_AGE_MS = 60 * 60 * 1000;

/** The newest "started a group call" message, if it is recent enough, else null. */
export const findActiveGroupCall = (
  messages: readonly MessageRecord[],
  now: number = Date.now(),
): MessageRecord | null => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.content?.type === 'call_event' && m.content.group && m.content.outcome === 'started')
      return now - Date.parse(m.created_at) < GROUP_CALL_MAX_AGE_MS ? m : null;
  }
  return null;
};
