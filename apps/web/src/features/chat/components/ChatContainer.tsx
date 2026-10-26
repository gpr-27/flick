import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropOverlay } from './DropOverlay';
import { accentStyle, useChatLook } from '../../organise/chatLook';
import type { MessageRecord } from '@chat/contracts';
import type { ConversationSummary } from '@chat/contracts';
import { ErrorState } from '@/components/ui';
import { formatDateSeparator, isNewDay } from '@/lib/time';
import { useConnectionState } from '@/lib/realtime';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useFeatureGuides } from '@/features/guide/useFeatureGuide';
import { FlickThinking } from '@/features/ai/FlickThinking';
import { FlickChatTools } from '@/features/ai/flick/FlickChatTools';
import { TopicDivider } from '@/features/ai/flick/TopicDivider';
import { topicStartingAt, useFlickTopics } from '@/features/ai/flick/useFlickTopics';
import { FlickPromptChips, FlickWelcome } from '@/features/ai/FlickWelcome';
import { useFlickThinking } from '@/features/ai/useFlickThinking';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { GroupCallBanner } from '@/features/groupcall/components/GroupCallBanner';
import { SafetyBanners } from '@/features/safety/SafetyBanners';
import { galleryItems } from '../../gallery/gallery';
import { MediaLightbox } from '../../gallery/MediaLightbox';
import { conversationAvatar, conversationTitle } from '../conversationView';
import { sendMessage, useOutboxStore } from '../outbox/useOutboxStore';
import { useUnexpired } from '@/features/content/disappearing';
import { previewContent, type ContentContext } from '../content/registry';
import { LockScreen } from '../../organise/ChatLock';
import { ForwardModal } from '../../organise/ForwardModal';
import { useJumpEffect, useJumpStore } from '../../organise/jump';
import { useIsHidden } from '../../organise/lock';
import { toggleStar, usePinsStore } from '../../organise/messageActions';
import { PinnedBar } from '../../organise/PinnedBar';
import { useWallpaper } from '../../organise/useWallpaper';
import { useSettingsStore } from '../../settings/useSettingsStore';
import { SelectionBar } from '../selection/SelectionBar';
import { useSelectedIds, useSelectionStore } from '../selection/useSelectionStore';
import { buildRows, firstUnreadKey, groupPosition, rowStatus, type ThreadRow } from '../threadRows';
import { useChatStore, userName, type Activity } from '../useChatStore';
import { ChatHeader } from './ChatHeader';
import { SavedTools } from '@/features/productivity/SavedTools';
import { ActivityBubble, MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { MessageSkeleton } from './MessageSkeleton';
import { VirtualMessageList, type VirtualMessageListHandle } from './VirtualMessageList';

const estimateRow = (row: ThreadRow): number => {
  const type = row.message.content?.type;
  if (type === 'image' || type === 'video') return 320;
  const text = row.message.content?.type === 'text' ? row.message.content.text : '';
  return text.length > 120 ? 110 : 72;
};

const EmptyThread = ({ title }: { title: string }) => (
  <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
    <div
      className="grid size-20 place-items-center rounded-3xl bg-primary/10 text-4xl shadow-inner"
      aria-hidden="true"
    >
      👋
    </div>
    <div className="space-y-1.5">
      <p className="font-display text-xl font-bold tracking-tight">Say hi to {title}</p>
      <p className="max-w-xs text-sm leading-relaxed text-base-content/60">
        This is the beginning of your conversation. Send a message to get started.
      </p>
    </div>
  </div>
);

/** True while this tab is visible and focused: only then do incoming messages count as read. */
const useWindowFocused = (): boolean => {
  const [focused, setFocused] = useState(
    () => document.visibilityState === 'visible' && document.hasFocus(),
  );
  useEffect(() => {
    const update = (): void => {
      setFocused(document.visibilityState === 'visible' && document.hasFocus());
    };
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return focused;
};

const activityLabel = (kind: Activity): string =>
  kind === 'typing'
    ? 'typing…'
    : kind === 'recording_voice'
      ? 'recording audio…'
      : kind === 'recording_video'
        ? 'recording video…'
        : 'sending a file…';

const ChatThread = ({ conversation }: { conversation: ConversationSummary }) => {
  const id = conversation.id;
  const myId = useSessionStore((s) => s.user?.id ?? '');
  const thread = useChatStore((s) => s.threads[id]);
  const receipts = useChatStore((s) => s.receipts[id]);
  const activity = useChatStore((s) => s.typing[id]);
  const users = useChatStore((s) => s.users);
  const members = useChatStore((s) => s.members[id]);
  const outbox = useOutboxStore((s) => s.items);
  const connection = useConnectionState();
  const focused = useWindowFocused();

  const reactTo = useChatStore((s) => s.react);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const setEditing = useChatStore((s) => s.setEditing);

  const defaultWallpaper = useSettingsStore((s) => s.defaultWallpaper);
  const wallpaperDim = useSettingsStore((s) => s.wallpaperDim);
  const wallpaper = useWallpaper(conversation.prefs.wallpaper ?? defaultWallpaper).style;
  const isGroup = conversation.type === 'group';
  const title = conversationTitle(conversation);
  const look = useChatLook(id);
  const messages = thread?.messages;
  const allRows = useMemo(() => buildRows(messages ?? [], outbox, id), [messages, outbox, id]);
  const rows = useUnexpired(allRows);
  const isBot = isFlickChat(conversation);
  const flickTopics = useFlickTopics((s) => s.topics);
  const thinking = useFlickThinking(
    rows.map((r) => r.message),
    myId,
    conversation,
  );
  const bySeqId = useMemo(
    () => new Map((messages ?? []).map((m) => [m.message_id, m])),
    [messages],
  );
  const memberById = useMemo(
    () => new Map((members ?? []).map((m) => [m.user.id, m.user])),
    [members],
  );

  // How many messages were unread when this chat was opened; the divider stays put after they
  // are marked read, and goes away when the chat is closed.
  const [opened, setOpened] = useState<{ id: string; unread: number } | null>(null);
  if (opened?.id !== id && thread?.status === 'ready') {
    setOpened({ id, unread: conversation.unread_count });
  }
  const openedUnread = opened?.id === id ? opened.unread : 0;
  const unreadKey = useMemo(
    () => firstUnreadKey(rows, myId, openedUnread),
    [rows, myId, openedUnread],
  );

  const listRef = useRef<VirtualMessageListHandle>(null);
  // The "jump to first unread" button goes away once used (per chat).
  const [jumpedFor, setJumpedFor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Group chats need the member list to show who wrote what.
  useEffect(() => {
    if (isGroup && !members) void useChatStore.getState().loadMembers(id);
  }, [isGroup, members, id]);

  // The conversation is "in view" when it is open, loaded and the window is focused. Then
  // incoming messages are read: send read_ack (again when the connection comes back).
  const ready = thread?.status === 'ready';
  // First-open tips about reading a chat (see features/guide). The ticks only exist on your own messages.
  const hasMessages = ready && (messages?.length ?? 0) > 0;
  const hasMine = hasMessages && (messages ?? []).some((m) => m.sender_user_id === myId);
  useFeatureGuides(['message.menu', 'message.dates'], hasMessages);
  useFeatureGuides(['message.ticks'], hasMine);
  const inView = ready && focused;
  useEffect(() => {
    useChatStore.getState().setInView(inView);
    return () => {
      useChatStore.getState().setInView(false);
    };
  }, [inView]);
  useEffect(() => {
    if (inView && connection === 'connected') useChatStore.getState().markRead(id);
  }, [inView, connection, id, conversation.last_seq, conversation.unread_count]);

  // Announce new incoming messages to screen readers (the list itself is silent).
  const lastIncoming = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const m = messages?.[i];
      if (m && m.sender_user_id !== myId && m.content?.type !== 'system') return m;
    }
    return undefined;
  }, [messages, myId]);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!lastIncoming || !ready) return;
    if (announced.current === null) {
      announced.current = lastIncoming.message_id; // don't announce history on open
      return;
    }
    if (announced.current === lastIncoming.message_id) return;
    announced.current = lastIncoming.message_id;
    setAnnouncement(
      `New message from ${userName(users, lastIncoming.sender_user_id)}: ${previewContent(lastIncoming.content)}`,
    );
  }, [lastIncoming, ready, users]);

  const loadOlder = useCallback(() => {
    void useChatStore.getState().loadOlder(id);
  }, [id]);
  const jumpTo = useCallback(
    (messageId: string) => {
      const target = bySeqId.get(messageId);
      if (!target) return;
      listRef.current?.scrollToKey(target.client_message_id ?? target.message_id);
      useJumpStore.getState().flash(target.message_id);
    },
    [bySeqId],
  );
  const scrollToMessage = useCallback((m: MessageRecord) => {
    listRef.current?.scrollToKey(m.client_message_id ?? m.message_id);
  }, []);
  useJumpEffect(id, scrollToMessage);
  const flashId = useJumpStore((s) => s.flashId);
  const pins = usePinsStore((s) => s.byConversation[id]);
  const pinnedIds = useMemo(() => new Set((pins ?? []).map((m) => m.message_id)), [pins]);
  const togglePin = usePinsStore((s) => s.toggle);
  const [forwarding, setForwarding] = useState<MessageRecord | null>(null);
  // Choosing several messages: the ticked ids, and a tap that ticks or unticks one.
  const selectedIds = useSelectedIds(id);
  const selecting = selectedIds.length > 0;
  const selectMessage = useCallback(
    (m: MessageRecord) => {
      useSelectionStore.getState().toggle(id, m.message_id);
    },
    [id],
  );
  // Leaving the chat ends the selection.
  useEffect(
    () => () => {
      useSelectionStore.getState().clear();
    },
    [id],
  );
  const contentContext = useMemo<ContentContext>(() => ({ onOpenImage: setLightbox }), []);
  const retry = useOutboxStore.getState().retry;
  const discard = useOutboxStore.getState().discard;

  const others = Object.entries(activity ?? {}).filter(([userId]) => userId !== myId);
  const firstOther = others[0];
  const activityRow = firstOther ? (
    <ActivityBubble
      avatar={conversationAvatar(conversation)}
      label={
        isGroup
          ? others.length > 1
            ? 'Several people are typing…'
            : `${userName(users, firstOther[0])} is ${activityLabel(firstOther[1])}`
          : `${title} is ${activityLabel(firstOther[1])}`
      }
    />
  ) : thinking ? (
    <FlickThinking />
  ) : null;

  // Flick's welcome message is the first message of a new Flick chat; until the person writes
  // something, the example prompts stay available right under it.
  const showPrompts =
    isBot && rows.length > 0 && !rows.some((r) => r.message.sender_user_id === myId);
  const footer = showPrompts ? (
    <>
      <FlickPromptChips
        onPick={(prompt) => {
          sendMessage(myId, id, { type: 'text', text: prompt });
        }}
      />
      {activityRow}
    </>
  ) : (
    activityRow
  );

  let body;
  if (!thread || thread.status === 'loading') {
    body = <MessageSkeleton />;
  } else if (thread.status === 'error' && rows.length === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="Couldn't load messages"
          message={thread.error ?? 'Something went wrong while loading this conversation.'}
          onRetry={() => {
            useChatStore.getState().retryThread(id);
          }}
        />
      </div>
    );
  } else if (rows.length === 0 && !activityRow) {
    body = isBot ? (
      <FlickWelcome
        onPick={(prompt) => {
          sendMessage(myId, id, { type: 'text', text: prompt });
        }}
      />
    ) : (
      <EmptyThread title={title} />
    );
  } else {
    body = (
      <VirtualMessageList
        // Remount per conversation so scroll state never leaks between chats.
        key={id}
        ref={listRef}
        items={rows}
        getKey={(row) => row.key}
        estimateSize={estimateRow}
        label={`Conversation with ${title}`}
        hasOlder={thread.hasOlder}
        isLoadingOlder={thread.loadingOlder}
        onLoadOlder={loadOlder}
        footer={footer}
        dateLabel={(row) => formatDateSeparator(row.message.created_at)}
        renderItem={(row, index) => {
          const { message } = row;
          const senderId = message.sender_user_id;
          const sender = senderId ? (users[senderId] ?? memberById.get(senderId) ?? null) : null;
          const { startsGroup, endsGroup } = groupPosition(rows, index);
          const quoted = message.content?.reply_to
            ? (bySeqId.get(message.content.reply_to) ?? null)
            : null;
          const topic =
            isBot && !(index === 0 && thread.hasOlder)
              ? topicStartingAt(flickTopics, rows[index - 1]?.message.seq ?? 0, message.seq)
              : undefined;
          const bubble = (
            <MessageBubble
              row={row}
              myId={myId}
              sender={sender}
              isGroup={isGroup}
              status={
                isBot && !row.local
                  ? 'read' // the assistant always "reads" what you send
                  : rowStatus(row, receipts, Math.max(1, conversation.member_count - 1))
              }
              quoted={quoted}
              quotedName={
                quoted?.sender_user_id === myId
                  ? 'You'
                  : userName(users, quoted?.sender_user_id ?? null)
              }
              showDate={isNewDay(rows[index - 1]?.message.created_at, message.created_at)}
              startsGroup={startsGroup}
              endsGroup={endsGroup}
              unreadCount={row.key === unreadKey ? openedUnread : 0}
              onReact={(m, emoji) => void reactTo(m, emoji)}
              onReply={setReplyingTo}
              onEdit={setEditing}
              onDelete={(m, scope) => void deleteMessage(m, scope)}
              onRetry={retry}
              onDiscard={discard}
              content={contentContext}
              onJumpTo={jumpTo}
              onStar={(m) => void toggleStar(m)}
              onPin={(m) => void togglePin(m)}
              onForward={setForwarding}
              pinned={pinnedIds.has(message.message_id)}
              highlighted={flashId === message.message_id}
              selecting={selecting}
              selected={selectedIds.includes(message.message_id)}
              onSelect={selectMessage}
            />
          );
          return topic ? (
            <>
              <TopicDivider topic={topic} />
              {bubble}
            </>
          ) : (
            bubble
          );
        }}
      />
    );
  }

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={`Chat with ${title}`}
      style={accentStyle(look.accent)}
    >
      <DropOverlay />
      {selecting ? (
        <SelectionBar messages={messages ?? []} ids={selectedIds} myId={myId} />
      ) : (
        <ChatHeader conversation={conversation} />
      )}
      {isGroup && <GroupCallBanner conversationId={id} messages={messages ?? []} />}
      <SafetyBanners conversation={conversation} messages={messages} />
      <PinnedBar conversationId={id} />
      {conversation.is_saved && <SavedTools savedConversationId={id} />}
      <div
        className={`relative flex min-h-0 flex-1 flex-col ${wallpaper ? 'isolate' : 'app-bg'}`}
        style={wallpaper ?? undefined}
      >
        {wallpaper && wallpaperDim > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: `rgba(0,0,0,${String(wallpaperDim / 100)})` }}
          />
        )}
        {body}
        {unreadKey && jumpedFor !== id && (
          <button
            type="button"
            className="btn btn-primary btn-sm absolute left-1/2 top-3 z-10 -translate-x-1/2 shadow-lg"
            onClick={() => {
              listRef.current?.scrollToKey(unreadKey);
              setJumpedFor(id);
            }}
          >
            {openedUnread} unread {openedUnread === 1 ? 'message' : 'messages'}
          </button>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {conversation.settings.only_admins_send && conversation.my_role === 'member' ? (
        <p className="border-t border-base-content/10 p-4 text-center text-sm text-base-content/60">
          Only admins can send messages
        </p>
      ) : (
        <>
          {isBot && ready && (
            <FlickChatTools conversationId={id} myId={myId} messages={messages ?? []} />
          )}
          <MessageInput key={id} conversation={conversation} messages={messages ?? []} />
        </>
      )}
      <ForwardModal
        message={forwarding}
        onClose={() => {
          setForwarding(null);
        }}
      />
      <MediaLightbox
        items={galleryItems(messages ?? [])}
        startId={lightbox}
        onClose={() => {
          setLightbox(null);
        }}
      />
    </section>
  );
};

/** A locked chat shows only the passcode screen until it is unlocked in this tab. */
export const ChatContainer = ({ conversation }: { conversation: ConversationSummary }) => {
  const hidden = useIsHidden(conversation.id, conversation.prefs.locked);
  return hidden ? (
    <LockScreen conversation={conversation} />
  ) : (
    <ChatThread conversation={conversation} />
  );
};

export default ChatContainer;
