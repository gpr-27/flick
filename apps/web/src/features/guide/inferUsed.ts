// Features a person has clearly used already, worked out from what is in their chat list. An
// existing user should never be told how to do something they have done for months.
import type { ConversationSummary } from '@chat/contracts';
import { isFlickChat } from '@/features/ai/isFlickBot';

export function inferUsedTopics(
  conversations: readonly ConversationSummary[],
  myId: string,
): string[] {
  const used: string[] = [];
  if (conversations.some((c) => c.type === 'group')) used.push('group.create');
  if (conversations.some((c) => c.last_message?.sender_user_id === myId)) {
    used.push('composer.basics', 'chats.new');
  }
  if (conversations.some((c) => isFlickChat(c) && c.last_message)) used.push('ai.flickchat');
  if (conversations.some((c) => c.is_saved && c.last_message)) used.push('saved.messages');
  if (conversations.some((c) => c.prefs.pinned && !isFlickChat(c))) used.push('chat.options');
  return used;
}
