// How a conversation looks in lists and headers, derived from its summary.
import type { ConversationSummary } from '@chat/contracts';
import { formatLastSeen } from '@/lib/time';

export const conversationTitle = (c: ConversationSummary): string =>
  c.type === 'direct' ? (c.peer?.display_name ?? 'Unknown') : (c.title ?? 'Group');

export const conversationAvatar = (c: ConversationSummary): string | null =>
  c.type === 'direct' ? (c.peer?.avatar_url ?? null) : c.avatar_url;

/** "Online", "last seen today at 14:05", or '' when unknown or hidden by the user's privacy settings. */
export const presenceLabel = (
  presence: { online: boolean; last_seen_at: string | null } | undefined,
): string => {
  if (!presence) return '';
  if (presence.online) return 'Online';
  return presence.last_seen_at ? `last seen ${formatLastSeen(presence.last_seen_at)}` : '';
};
