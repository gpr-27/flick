import { InstallCard } from '@/pwa/InstallCard';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
  Pin,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { EmptyState, ErrorState, Input, cn, type PopoverMenuItem } from '@/components/ui';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { WelcomeCard } from '@/features/guide/WelcomeCard';
import { useFeatureGuide, useFeatureGuides } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CHAT_TABS, visibleChats, type ChatTab, type ChatView } from '../../organise/chatFilters';
import { StarredPanel } from '../../organise/StarredPanel';
import { useNavigate } from 'react-router-dom';
import { SearchPanel } from '../../search/SearchPanel';
import { ListTabs } from '../../lists/ListTabs';
import { needsReply } from '../../understand/heuristics';
import { isSnoozed, useSnoozes } from '../../understand/snooze';
import { GlobalSearchResults } from '../../lists/GlobalSearchResults';
import { useChatLists } from '../../lists/useChatLists';
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
import { DigestCard } from '@/features/productivity/DigestCard';
import { ChatRow } from '../../chatlist/ChatRow';
import { HiddenChatsRow } from '../../platform/HiddenChatsVault';
import { useVaultOn } from '../../platform/useVaultOn';
import { RowMenu } from '../../chatlist/RowMenu';
import { SelectionBar } from '../../chatlist/SelectionBar';
import { clearMarkedUnreadOnOpen, type ActionId } from '../../chatlist/rowActions';
import { useChatActions } from '../../chatlist/useChatActions';
import { useOpenRow } from '../../chatlist/useOpenRow';
import { useSelection } from '../../chatlist/useSelection';

// The header buttons all share one size: 36px on laptops, 40px (a bigger touch target) on phones.
const HEADER_BUTTON =
  'btn btn-circle btn-ghost btn-sm size-9 min-h-0 text-base-content hover:bg-[var(--bg-hover,oklch(var(--bc)/0.06))] hover:text-primary max-sm:size-10';
const HEADER_MENU_TRIGGER = 'size-9 min-h-0 max-sm:size-10';

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
  // WhatsApp style: your own name with "(You)" and the subtitle "Message yourself".
  const myName = useSessionStore((s) => s.user?.display_name);
  const selfTitle = myName ? `${myName} (You)` : SAVED_TITLE;
  return (
    <div className="group relative">
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
          'flex min-h-[72px] w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
          isActive
            ? 'bg-[var(--bg-active,oklch(var(--p)/0.1))]'
            : 'bg-base-100 hover:bg-[var(--bg-hover,oklch(var(--bc)/0.05))]',
        )}
      >
        <span className="grid size-[52px] shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Bookmark className="size-6" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 truncate text-base font-semibold">
            <span className="truncate">{selfTitle}</span>
            <Pin className="size-4 shrink-0 text-primary" aria-label="Pinned" role="img" />
          </span>
          <span className="block truncate text-sm text-[var(--text-2,oklch(var(--bc)/0.65))]">
            {last ? previewContent(last.content) : 'Message yourself'}
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
          className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-base-100 text-[var(--text-2,oklch(var(--bc)/0.65))] opacity-0 shadow-md ring-1 ring-base-content/10 transition-opacity hover:text-primary group-hover:opacity-100 [@media(hover:none)]:hidden"
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

const closeOpenRow = (): void => {
  useOpenRow.getState().close();
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
  const [listId, setListId] = useState<string | null>(null);
  const [onlyNeedsReply, setOnlyNeedsReply] = useState(false);
  const snoozes = useSnoozes((s) => s.until);
  const lists = useChatLists((s) => s.lists);
  const navigate = useNavigate();
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
  const vaultOn = useVaultOn();
  const all = useMemo(
    () => Object.values(conversations).filter((c) => !c.is_saved && !(vaultOn && c.prefs.locked)),
    [conversations, vaultOn],
  );
  const hiddenChats = useMemo(
    () =>
      vaultOn ? Object.values(conversations).filter((c) => !c.is_saved && c.prefs.locked) : [],
    [conversations, vaultOn],
  );
  const archivedCount = useMemo(() => all.filter((c) => c.prefs.archived).length, [all]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = lists.find((l) => l.id === listId);
    return visibleChats(all, tab, view)
      .filter((c) => !list || list.conversation_ids.includes(c.id))
      .filter((c) => !isSnoozed(snoozes, c.id) || c.id === selectedId)
      .filter((c) => !onlyNeedsReply || needsReply(c, myId))
      .filter((c) => conversationTitle(c).toLowerCase().includes(q));
  }, [all, tab, view, search, lists, listId, snoozes, onlyNeedsReply, myId, selectedId]);
  const needsReplyCount = useMemo(
    () => all.filter((c) => needsReply(c, myId) && !isSnoozed(snoozes, c.id)).length,
    [all, myId, snoozes],
  );
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

  const headerIcon = (Icon: typeof Star): ReactNode => (
    <Icon className="size-5" aria-hidden="true" />
  );
  const phoneItems: PopoverMenuItem[] = [
    {
      label: 'Starred messages',
      icon: headerIcon(Star),
      onClick: () => {
        markUsed('chat.starred');
        setStarredOpen(true);
      },
    },
    {
      label: 'Scheduled messages',
      icon: headerIcon(CalendarClock),
      onClick: () => {
        markUsed('scheduled.list');
        setScheduledOpen(true);
      },
    },
    {
      label: 'Reminders',
      icon: headerIcon(AlarmClock),
      onClick: () => {
        setRemindersOpen(true);
      },
    },
    {
      label: 'Calendar',
      icon: headerIcon(CalendarClock),
      onClick: () => {
        navigate('/calendar');
      },
    },
    {
      label: 'New group',
      icon: headerIcon(UsersRound),
      onClick: () => {
        markUsed('group.create');
        setNewGroup(true);
      },
    },
  ];

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
      className="flex h-full w-full flex-col border-r border-base-content/10 bg-base-100"
      aria-label="Conversations"
      data-guide="chat-list"
    >
      <InstallCard />
      <WelcomeCard />
      <div className="space-y-3 px-4 pb-2 pt-3 sm:px-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[22px] font-bold leading-7 tracking-tight">Chats</h2>
          {/* Same-size round buttons, evenly spaced. On phones only search, new chat and "⋮" stay;
              starred, scheduled, reminders and new group move into the "⋮" menu. */}
          <div className="flex items-center gap-0.5 max-sm:gap-1">
            <button
              type="button"
              className={HEADER_BUTTON}
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
              className={cn(HEADER_BUTTON, 'max-sm:hidden')}
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
              className={cn(HEADER_BUTTON, 'max-sm:hidden')}
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
              className={cn(HEADER_BUTTON, 'max-sm:hidden')}
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
              className={HEADER_BUTTON}
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
              className={cn(HEADER_BUTTON, 'max-sm:hidden')}
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
              triggerClassName={HEADER_MENU_TRIGGER}
              phoneItems={phoneItems}
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
          className="scroll-slim flex gap-2 overflow-x-auto px-4 py-1.5 sm:px-5"
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
                'h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'bg-primary text-primary-content'
                  : 'bg-[var(--bg-sunken,oklch(var(--b3)))] text-[var(--text-2,oklch(var(--bc)/0.7))] [@media(hover:hover)]:hover:bg-[var(--bg-hover,oklch(var(--bc)/0.08))]',
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
      {view === 'chats' && <ListTabs value={listId} onChange={setListId} />}
      {view === 'chats' && (needsReplyCount > 0 || onlyNeedsReply) && (
        <div className="px-4 pb-1 sm:px-5">
          <button
            type="button"
            aria-pressed={onlyNeedsReply}
            onClick={() => {
              setOnlyNeedsReply((v) => !v);
            }}
            className={cn(
              'h-8 rounded-full px-3.5 text-sm font-medium transition-colors',
              onlyNeedsReply
                ? 'bg-primary text-primary-content'
                : 'bg-[var(--bg-sunken,oklch(var(--b3)))] text-[var(--text-2,oklch(var(--bc)/0.7))] [@media(hover:hover)]:hover:bg-[var(--bg-hover,oklch(var(--bc)/0.08))]',
            )}
          >
            Needs reply · {needsReplyCount}
          </button>
        </div>
      )}

      <div
        className="scroll-slim flex-1 overflow-y-auto overscroll-contain pb-2 [-webkit-overflow-scrolling:touch]"
        onScroll={closeOpenRow}
      >
        {view === 'chats' && !search && <DigestCard onOpenChat={select} />}
        {view === 'chats' && archivedCount > 0 && (
          <button
            type="button"
            aria-label={`Archived (${archivedCount})`}
            className="flex min-h-[56px] w-full items-center gap-3 bg-base-100 px-4 py-2.5 text-left text-[15px] font-medium [@media(hover:hover)]:hover:bg-[var(--bg-hover,oklch(var(--bc)/0.05))]"
            onClick={() => {
              setView('archived');
            }}
          >
            <Archive className="size-5 text-primary" aria-hidden="true" />
            <span className="flex-1" aria-hidden="true">
              Archived
            </span>
            <span
              className="text-sm tabular-nums text-[var(--text-2,oklch(var(--bc)/0.65))]"
              aria-hidden="true"
            >
              {archivedCount}
            </span>
          </button>
        )}
        {view === 'chats' && (
          <HiddenChatsRow chats={hiddenChats} onOpen={select} titleOf={conversationTitle} />
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
                onFocus={setFocusedId}
                onAction={run}
              />
            ))}
          </ul>
        )}
        <GlobalSearchResults query={search} chats={filtered} onOpenChat={select} />
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
