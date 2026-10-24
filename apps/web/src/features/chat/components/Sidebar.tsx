import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Archive,
  BellOff,
  Lock,
  MessageSquarePlus,
  Pin,
  Search,
  Star,
  Users,
  UsersRound,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, Badge, EmptyState, ErrorState, Input, cn, formatCount } from '@/components/ui';
import { formatRelativeTime } from '@/lib/time';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { CHAT_TABS, visibleChats, type ChatTab, type ChatView } from '../../organise/chatFilters';
import { useDraftStore } from '../../organise/drafts';
import { useIsHidden } from '../../organise/lock';
import { isMuted } from '../../organise/prefs';
import { StarredPanel } from '../../organise/StarredPanel';
import { SearchPanel } from '../../search/SearchPanel';
import { previewContent } from '../content/registry';
import { conversationAvatar, conversationTitle } from '../conversationView';
import { useChatStore } from '../useChatStore';
import { InviteButton } from '@/features/directory/InviteButton';
import { NewChatModal, NewGroupModal } from './NewChatModals';
import { SidebarSkeleton } from './SidebarSkeleton';

interface ConversationRowProps {
  conversation: ConversationSummary;
  myId: string | undefined;
  isOnline: boolean;
  isActive: boolean;
  isFocusTarget: boolean;
  onSelect: (id: string) => void;
  onFocus: () => void;
}

const ConversationRow = ({
  conversation: c,
  myId,
  isOnline,
  isActive,
  isFocusTarget,
  onSelect,
  onFocus,
}: ConversationRowProps) => {
  const unread = c.unread_count;
  const last = c.last_message;
  const prefix = last && last.sender_user_id === myId ? 'You: ' : '';
  const draft = useDraftStore((s) => s.drafts[c.id]);
  // A locked chat shows no message text until its passcode is entered in this tab.
  const hidden = useIsHidden(c.id, c.prefs.locked);
  const muted = isMuted(c.prefs);
  return (
    <li
      role="option"
      aria-selected={isActive}
      tabIndex={isFocusTarget ? 0 : -1}
      data-conversation-id={c.id}
      onClick={() => {
        onSelect(c.id);
      }}
      onFocus={onFocus}
      className={cn(
        'mb-1 flex w-full cursor-pointer items-center gap-3 rounded-2xl p-2.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/50',
        isActive ? 'bg-primary/12 ring-1 ring-primary/30' : 'hover:bg-base-content/5',
      )}
    >
      <Avatar src={conversationAvatar(c)} name="" size="md" online={isOnline} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('truncate', unread > 0 ? 'font-bold' : 'font-semibold')}>
            {conversationTitle(c)}
          </span>
          {last && (
            <span className="shrink-0 text-[11px] font-medium text-base-content/60">
              {formatRelativeTime(last.created_at)}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 truncate text-sm',
              unread > 0 ? 'text-base-content/80' : 'text-base-content/60',
            )}
          >
            {hidden ? (
              <span className="flex items-center gap-1 italic">
                <Lock className="size-3.5" aria-hidden="true" />
                Locked chat
              </span>
            ) : draft && !isActive ? (
              <>
                <span className="shrink-0 font-semibold text-error">Draft:</span>
                <span className="truncate">{draft}</span>
              </>
            ) : last ? (
              <>
                {prefix && <span className="shrink-0">{prefix}</span>}
                <span className="truncate">{previewContent(last.content)}</span>
              </>
            ) : (
              <span className="italic text-base-content/55">Tap to start chatting</span>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-1.5 text-base-content/50">
            {muted && <BellOff className="size-3.5" aria-label="Muted" role="img" />}
            {c.prefs.pinned && <Pin className="size-3.5" aria-label="Pinned" role="img" />}
            {c.prefs.favorite && <Star className="size-3.5" aria-label="Favourite" role="img" />}
            {unread > 0 && (
              <Badge variant="count" label={`${unread} unread`}>
                {formatCount(unread)}
              </Badge>
            )}
          </span>
        </div>
      </div>
    </li>
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
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => Object.values(conversations), [conversations]);
  const archivedCount = useMemo(() => all.filter((c) => c.prefs.archived).length, [all]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleChats(all, tab, view).filter((c) =>
      conversationTitle(c).toLowerCase().includes(q),
    );
  }, [all, tab, view, search]);

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
        if (target) select(target.id);
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
    >
      <div className="space-y-3 border-b border-base-content/10 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">Chats</h2>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Search messages"
              title="Search messages"
              onClick={() => {
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
              onClick={() => {
                setStarredOpen(true);
              }}
            >
              <Star className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="New chat"
              title="New chat"
              onClick={() => {
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
              onClick={() => {
                setNewGroup(true);
              }}
            >
              <UsersRound className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>

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

      {view === 'chats' ? (
        <div role="tablist" aria-label="Filter chats" className="flex gap-1 px-3 pt-2">
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

      <div className="scroll-slim flex-1 overflow-y-auto p-2">
        {view === 'chats' && archivedCount > 0 && (
          <button
            type="button"
            className="mb-1 flex w-full items-center gap-3 rounded-2xl p-2.5 text-left text-sm font-semibold hover:bg-base-content/5"
            onClick={() => {
              setView('archived');
            }}
          >
            <Archive className="size-5" aria-hidden="true" />
            Archived ({archivedCount})
          </button>
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
          <ul ref={listRef} role="listbox" aria-label="Chats" onKeyDown={onListKeyDown}>
            {filtered.map((c) => (
              <ConversationRow
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
    </aside>
  );
};

export default Sidebar;
