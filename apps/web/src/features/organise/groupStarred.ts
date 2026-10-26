import type { MessageRecord } from '@chat/contracts';

/** Filters by chat name or text and groups by chat (stable, so a chat's messages stay newest first). */
export const groupStarred = (
  items: readonly MessageRecord[],
  titleOf: (conversationId: string) => string,
  text: (m: MessageRecord) => string,
  filter: string,
): MessageRecord[] => {
  const q = filter.trim().toLowerCase();
  const kept = items.filter(
    (m) =>
      !q ||
      text(m).toLowerCase().includes(q) ||
      titleOf(m.conversation_id).toLowerCase().includes(q),
  );
  const order = [...new Set(kept.map((m) => m.conversation_id))];
  return order.flatMap((id) => kept.filter((m) => m.conversation_id === id));
};
