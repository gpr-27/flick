// Suggests a folder or tag for a chat that is in none yet. A local guess from the names: a list
// whose name appears in the chat title or its latest message, else "Groups"/"Friends"-like names.
import type { ChatListItem, ConversationSummary } from '@chat/contracts';

const text = (c: ConversationSummary): string => {
  const last = c.last_message?.content;
  const body = last && 'text' in last && typeof last.text === 'string' ? last.text : '';
  return `${c.title ?? ''} ${body}`.toLowerCase();
};

export function suggestList(
  c: ConversationSummary,
  lists: readonly ChatListItem[],
): ChatListItem | null {
  if (c.is_saved || lists.some((l) => l.conversation_ids.includes(c.id))) return null;
  const t = text(c);
  const named = lists.find(
    (l) => l.name.trim().length >= 3 && t.includes(l.name.trim().toLowerCase()),
  );
  if (named) return named;
  const kind = c.type === 'group' ? /group|team|work|family/i : /friend|personal|people/i;
  return lists.find((l) => kind.test(l.name)) ?? null;
}
