import { InstallCard } from '@/pwa/InstallCard';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Archive,
  Bookmark,
  AlarmClock,
  CalendarClock,
  MessageSquarePlus,
  MoreVertical,
  Search,
  Star,
  Users,
  UsersRound,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { EmptyState, ErrorState, Input, cn } from '@/components/ui';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { WelcomeCard } from '@/features/guide/WelcomeCard';
import { useFeatureGuide, useFeatureGuides } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CHAT_TABS, visibleChats, type ChatTab, type ChatView } from '../../organise/chatFilters';
import { StarredPanel } from '../../organise/StarredPanel';
import { SearchPanel } from '../../search/SearchPanel';
import { RemindersDialog } from '@/features/reminders/RemindersDialog';
import { useLoadReminders } from '@/features/reminders/useLoadReminders';
import { ScheduledDialog } from '@/features/scheduled/ScheduledDialog';
import { previewContent } from '../content/registry';
import { SAVED_TITLE, conversationTitle } from '../conversationView';
import { useChatStore } from '../useChatStore';
import { InviteButton } from '@/features/directory/InviteButton';
import { NewChatModal, NewGroupModal } from './NewChatModals';
import { ChatListMenu } from '../../notifications/ChatListMenu';
import { PushPrompt } from '../../notifications/PushPrompt';
import { SidebarSkeleton } from './SidebarSkeleton';
import { ChatRow } from '../../chatlist/ChatRow';
import { RowMenu } from '../../chatlist/RowMenu';
import { SelectionBar } from '../../chatlist/SelectionBar';
import { clearMarkedUnreadOnOpen, type ActionId } from '../../chatlist/rowActions';
import { useChatActions } from '../../chatlist/useChatActions';
import { useOpenRow } from '../../chatlist/useOpenRow';
import { useSelection } from '../../chatlist/useSelection';

/** "Saved messages" (notes to yourself): always the first row; the chat is created on first tap. */
const SavedRow = ({
  conversation,
  isActive,
  onAction,
}: {
  conversation: ConversationSummary | undefined;
  isActive: boolean;
  onAction: (id: ActionId, c: ConversationSummary) => void;
}) => {
  const select = useChatStore((s) => s.select);
  const openSaved = useChatStore((s) => s.openSaved);
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const last = conversation?.last_message;
  return (
    <div className="group relative mb-2">
      <button
        type="button"
        data-guide="saved-row"
        aria-current={isActive}
        onClick={() => {
          if (conversation) select(conversation.id);
          else void openSaved();
        }}
        onContextMenu={(e) => {
          if (!conversation) return;
          e.preventDefault();
          setMenu(true);
        }}
        className={cn(
          'flex min-h-[64px] w-full items-center gap-3 rounded-2xl border p-2.5 text-left outline-none backdrop-blur-md transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/50',
          isActive
            ? 'border-primary/40 bg-primary/10 ring-1 ring-primary/30'
            : 'border-base-content/10 bg-base-100/70 hover:bg-base-100',
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Bookmark className="size-6" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{SAVED_TITLE}</span>
          <span className="block truncate text-sm text-base-content/60">
            {last ? previewContent(last.content) : 'Notes to yourself'}
          </span>
        </span>
      </button>
      {conversation && (
        <button
          ref={menuAnchor}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => {
            setMenu(true);
          }}
          className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-base-100/90 text-base-content/70 opacity-0 shadow transition-opacity hover:text-primary group-hover:opacity-100 [@media(hover:none)]:hidden"
        >
          <MoreVertical className="size-5" />
        </button>
      )}
      {menu && conversation && (
        <RowMenu
          conversation={conversation}
          anchor={menuAnchor}
          onAction={(id) => {
            onAction(id, conversation);
          }}
          onSelect={() => undefined}
          onClose={() => {
            setMenu(false);
          }}
        />
      )}
    </div>
  );
};

export const Sidebar = () => {
  const conversations = useChatStore((s) => s.conversations);
  const listStatus = useChatStore((s) => s.listStatus);
  const listError = useChatStore((s) => s.listError);
  const selectedId = useChatStore((s) => s.selectedId);
  const presence = useChatStore((s) => s.presence);
  const select = useChatStore((s) => s.select);
  const myId = useSessionStore((s) => s.user?.id);

  const [search, setSearch] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [newChat, setNewChat] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [tab, setTab] = useState<ChatTab>('all');
  const [view, setView] = useState<ChatView>('chats');
  const [searchOpen, setSearchOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  useLoadReminders();
  const listRef = useRef<HTMLUListElement>(null);
  const selecting = useSelection((s) => s.active);
  const selectedIds = useSelection((s) => s.ids);
  const { run, askDelete, dialogs } = useChatActions();

  // A chat marked as unread loses its dot once it is opened.
  useEffect(() => {
    if (selectedId) clearMarkedUnreadOnOpen(selectedId);
  }, [selectedId]);
  // Switching the list (tabs, archived) or leaving the screen ends select mode and closes swipes.
  useEffect(() => {
    useSelection.getState().end();
    useOpenRow.getState().close();
  }, [tab, view]);
  useEffect(
    () => () => {
      useSelection.getState().end();
      useOpenRow.getState().close();
    },
    [],
  );

  // Saved messages has its own row at the top, so it is not part of the filtered list.
  const saved = useMemo(
    () => Object.values(conversations).find((c) => c.is_saved),
    [conversations],
  );
  const all = useMemo(
    () => Object.values(conversations).filter((c) => !c.is_saved),
    [conversations],
  );
  const archivedCount = useMemo(() => all.filter((c) => c.prefs.archived).length, [all]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleChats(all, tab, view).filter((c) =>
      conversationTitle(c).toLowerCase().includes(q),
    );
  }, [all, tab, view, search]);
  const showSaved =
    view === 'chats' &&
    tab === 'all' &&
    SAVED_TITLE.toLowerCase().includes(search.trim().toLowerCase());

  // First-open tips for what the list offers. Someone who already has notes saved has used Saved
  // messages, so it is never shown to them as new.
  const usedSaved = Boolean(saved?.last_message);
  useEffect(() => {
    if (usedSaved) markUsed('saved.messages');
  }, [usedSaved]);
  useFeatureGuide('saved.messages', listStatus === 'ready' && showSaved && !usedSaved);
  useFeatureGuide('search.chat', listStatus === 'ready');
  const hasChats = listStatus === 'ready' && all.length > 0;
  useFeatureGuides(
    ['chats.list', 'chats.new', 'chat.starred', 'scheduled.list', 'group.create'],
    listStatus === 'ready',
  );
  useFeatureGuide('ai.flickchat', hasChats && all.some((c) => isFlickChat(c)));
  // Someone who already has a group has used groups; never show it to them as new.
  const hasGroup = all.some((c) => c.type === 'group');
  useEffect(() => {
    if (hasGroup) markUsed('group.create');
  }, [hasGroup]);

  if (listStatus === 'idle' || (listStatus === 'loading' && all.length === 0)) {
    return <SidebarSkeleton />;
  }

  // Roving tabindex: exactly one row is tabbable (the focused, else selected, else first).
  const focusTargetId =
    filtered.find((c) => c.id === focusedId)?.id ??
    filtered.find((c) => c.id === selectedId)?.id ??
    filtered[0]?.id;

  const focusRow = (index: number): void => {
    const target = filtered[index];
    if (!target) return;
    setFocusedId(target.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(target.id)}"]`)
      ?.focus();
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    const current = filtered.findIndex((c) => c.id === focusTargetId);
    switch (e.key) {
      case 'ArrowDown':
        focusRow(Math.min(filtered.length - 1, current + 1));
        break;
      case 'ArrowUp':
        focusRow(Math.max(0, current - 1));
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(filtered.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const target = filtered[current];
        if (target && selecting) useSelection.getState().toggle(target.id);
        else if (target) select(target.id);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <aside
      className="glass flex h-full w-full flex-col border-r border-base-content/10"
      aria-label="Conversations"
      data-guide="chat-list"
    >
      <InstallCard />
      <WelcomeCard />
      <div className="space-y-3 border-b border-base-content/10 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">Chats</h2>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Search messages"
              title="Search messages"
              data-guide="search.messages"
              onClick={() => {
                markUsed('search.chat');
                setSearchOpen(true);
              }}
            >
              <Search className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Starred messages"
              title="Starred messages"
              data-guide="starred.open"
              onClick={() => {
                markUsed('chat.starred');
                setStarredOpen(true);
              }}
            >
              <Star className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Scheduled messages"
              title="Scheduled messages"
              data-guide="scheduled.open"
              onClick={() => {
                markUsed('scheduled.list');
                setScheduledOpen(true);
              }}
            >
              <CalendarClock className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Reminders"
              title="Reminders"
              onClick={() => {
                setRemindersOpen(true);
              }}
            >
              <AlarmClock className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="New chat"
              title="New chat"
              data-guide="new-chat"
              onClick={() => {
                markUsed('chats.new');
                setNewChat(true);
              }}
            >
              <MessageSquarePlus className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="New group"
              title="New group"
              data-guide="new-group"
              onClick={() => {
                markUsed('group.create');
                setNewGroup(true);
              }}
            >
              <UsersRound className="size-5" aria-hidden="true" />
            </button>
            <ChatListMenu
              onSelectChats={() => {
                useSelection.getState().begin();
              }}
            />
          </div>
        </div>

        <div data-guide="chat-list.search">
          <Input
            type="search"
            label="Search chats"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search chats"
            leadingIcon={<Search className="size-4" />}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusRow(0);
              }
            }}
          />
        </div>
      </div>

      {all.length > 0 && <PushPrompt />}

      {selecting && (
        <SelectionBar
          chats={selectedIds.flatMap((id) => conversations[id] ?? [])}
          visibleIds={filtered.map((c) => c.id)}
          archivedView={view === 'archived'}
          onDelete={askDelete}
        />
      )}

      {view === 'chats' ? (
        <div
          role="tablist"
          aria-label="Filter chats"
          data-guide="chat-list.tabs"
          className="flex gap-1 px-3 pt-2"
        >
          {CHAT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-primary text-primary-content' : 'hover:bg-base-content/5',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-2">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setView('chats');
            }}
          >
            Back to chats
          </button>
          <h3 className="text-sm font-semibold">Archived</h3>
        </div>
      )}

      <div
        className="scroll-slim flex-1 overflow-y-auto p-2"
        onScroll={() => {
          useOpenRow.getState().close();
        }}
      >
        {view === 'chats' && archivedCount > 0 && (
          <button
            type="button"
            aria-label={`Archived (${archivedCount})`}
            className="mb-2 flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-base-content/10 bg-base-100/70 p-2.5 text-left text-sm font-semibold backdrop-blur-md hover:bg-base-100"
            onClick={() => {
              setView('archived');
            }}
          >
            <Archive className="size-5 text-primary" aria-hidden="true" />
            <span className="flex-1" aria-hidden="true">
              Archived
            </span>
            <span className="text-base-content/60" aria-hidden="true">
              {archivedCount}
            </span>
          </button>
        )}
        {showSaved && (
          <SavedRow conversation={saved} isActive={saved?.id === selectedId} onAction={run} />
        )}
        {listStatus === 'error' && all.length === 0 ? (
          <ErrorState
            title="Couldn't load chats"
            message={listError ?? 'Something went wrong while loading your chats.'}
            onRetry={() => {
              void useChatStore.getState().loadConversations();
            }}
          />
        ) : filtered.length === 0 ? (
          <>
            <EmptyState
              icon={<Users className="size-8" />}
              title={all.length === 0 ? 'No chats yet' : 'No matches found'}
              description={all.length === 0 ? 'Start a new chat to say hello.' : undefined}
            />
            {all.length === 0 && (
              <div className="flex justify-center">
                <InviteButton />
              </div>
            )}
          </>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Chats"
            aria-multiselectable={selecting || undefined}
            onKeyDown={onListKeyDown}
          >
            {filtered.map((c) => (
              <ChatRow
                key={c.id}
                conversation={c}
                myId={myId}
                isOnline={Boolean(c.peer && presence[c.peer.id]?.online)}
                isActive={selectedId === c.id}
                isFocusTarget={c.id === focusTargetId}
                onSelect={select}
                onFocus={() => {
                  setFocusedId(c.id);
                }}
                onAction={run}
              />
            ))}
          </ul>
        )}
      </div>

      <SearchPanel
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
        }}
      />
      <StarredPanel
        open={starredOpen}
        onClose={() => {
          setStarredOpen(false);
        }}
      />
      <RemindersDialog
        open={remindersOpen}
        onClose={() => {
          setRemindersOpen(false);
        }}
      />
      <ScheduledDialog
        open={scheduledOpen}
        onClose={() => {
          setScheduledOpen(false);
        }}
      />
      <NewChatModal
        open={newChat}
        onClose={() => {
          setNewChat(false);
        }}
      />
      <NewGroupModal
        open={newGroup}
        onClose={() => {
          setNewGroup(false);
        }}
      />
      {dialogs}
    </aside>
  );
};

export default Sidebar;
