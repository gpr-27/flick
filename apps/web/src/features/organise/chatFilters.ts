// Which chats the list shows. The store holds every chat (including archived ones), so the
// tabs filter locally; the server applies the same rules when asked for a filter.
import type { ConversationSummary } from '@chat/contracts';
import { sortConversations } from '../chat/threadOps';

export type ChatTab = 'all' | 'unread' | 'favorites' | 'groups';
export type ChatView = 'chats' | 'archived';

export const CHAT_TABS: readonly { id: ChatTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'groups', label: 'Groups' },
];

const matchesTab = (c: ConversationSummary, tab: ChatTab): boolean => {
  switch (tab) {
    case 'all':
      return true;
    case 'unread':
      return c.unread_count > 0;
    case 'favorites':
      return c.prefs.favorite;
    case 'groups':
      return c.type === 'group';
  }
};

/** Pinned first, then latest activity. The archived view ignores the tabs. */
export const visibleChats = (
  all: readonly ConversationSummary[],
  tab: ChatTab,
  view: ChatView,
): ConversationSummary[] =>
  sortConversations(
    all.filter((c) =>
      view === 'archived' ? c.prefs.archived : !c.prefs.archived && matchesTab(c, tab),
    ),
  );
