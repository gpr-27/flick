import { AutoTranslated } from '@/features/translation/AutoTranslated';
import { memo, useState } from 'react';
import { AlbumGrid, ALBUM_ITEM_ATTR } from '../album/AlbumGrid';
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  Forward,
  Pin,
  Reply,
  Timer,
  Star,
} from 'lucide-react';
import type { MessageRecord, UserSummary } from '@chat/contracts';
import { Avatar, cn, notify } from '@/components/ui';
import { markUsed } from '@/features/guide/useGuideStore';
import { FlickAvatar, FlickBadge } from '@/features/ai/FlickBadge';
import { isFlickBot } from '@/features/ai/isFlickBot';
import { ModelTag } from '@/features/ai/ModelTag';
import { WhyFlickSaid } from '@/features/ai/WhyFlickSaid';
import { modelLabel } from '@/features/ai/modelLabel';
import { DescribeImageDialog } from '@/features/ai/DescribeImageDialog';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { TranslateChip } from '@/features/ai/TranslateChip';
import { InlineTranslation } from '@/features/ai/InlineTranslation';
import { MessageHints } from '@/features/understand/MessageHints';
import { TranslateDialog } from '@/features/ai/TranslateDialog';
import { ReportDialog } from '@/features/settings/components/ReportDialog';
import { formatDateSeparator, formatMessageTime } from '@/lib/time';
import { renderContent, previewContent, type ContentContext } from '../content/registry';
import type { RowStatus, ThreadRow } from '../threadRows';
import { haptic } from '../gestures/haptics';
import { LinkMenu } from '../gestures/LinkMenu';
import { senderColor } from '../gestures/senderColor';
import { useMessageGestures } from '../gestures/useMessageGestures';
import { MessageMenu } from './MessageMenu';
import { MessageInfoDialog } from './MessageInfoDialog';
import { QuickRemindDialog } from '@/features/productivity/QuickRemindDialog';
import { BookmarkDialog } from '@/features/productivity/BookmarkDialog';
import { EditHistoryDialog, NoteChip, NoteDialog } from '@/features/notes/MessageNotes';
import { ReminderMark } from '@/features/reminders/ReminderMark';
import { useContactInfo } from './useContactInfo';

export interface MessageBubbleProps {
  row: ThreadRow;
  myId: string;
  /** Who sent it (null for server-written messages). Used for group names and avatars. */
  sender: UserSummary | null;
  isGroup: boolean;
  status: RowStatus;
  /** The message this one replies to, if it is loaded. */
  quoted: MessageRecord | null;
  quotedName: string;
  showDate: boolean;
  /** First / last message of a run from one sender; a run shares one name and one avatar. */
  startsGroup?: boolean;
  endsGroup?: boolean;
  /** Draw an "N unread messages" divider above this message. */
  unreadCount?: number;
  onReact: (message: MessageRecord, emoji: string) => void;
  onReply: (message: MessageRecord) => void;
  onEdit: (message: MessageRecord) => void;
  onDelete: (message: MessageRecord, scope: 'me' | 'everyone') => void;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  content: ContentContext;
  onJumpTo: (messageId: string) => void;
  /** Organise actions; each button shows only when its handler is given. */
  onPin?: (message: MessageRecord) => void;
  onStar?: (message: MessageRecord) => void;
  onForward?: (message: MessageRecord) => void;
  pinned?: boolean;
  /** Briefly outlined after a jump to this message. */
  highlighted?: boolean;
  /** Several messages are being chosen: a tap ticks this one instead of doing its usual thing. */
  selecting?: boolean;
  selected?: boolean;
  /** Start choosing with this message, or tick / untick it when already choosing. */
  onSelect?: (message: MessageRecord) => void;
  /** Every ticked message id (an album ticks its items one by one). */
  selectedIds?: readonly string[];
}

const HEART = '❤️';

const StatusMark = ({ status }: { status: RowStatus }) => {
  switch (status) {
    case 'pending':
      return <Clock className="size-3.5" aria-label="Sending" role="img" />;
    case 'failed':
      return <AlertCircle className="size-3.5 text-error" aria-label="Not sent" role="img" />;
    case 'sent':
      return <Check className="size-3.5" aria-label="Sent" role="img" />;
    case 'delivered':
      return <CheckCheck className="size-3.5" aria-label="Delivered" role="img" />;
    case 'read':
      return <CheckCheck className="size-3.5 text-primary-text" aria-label="Read" role="img" />;
  }
};

const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    notify.success('Copied');
  } catch {
    notify.error("Couldn't copy");
  }
};

const MessageBubbleImpl = ({
  row,
  myId,
  sender,
  isGroup,
  status,
  quoted,
  quotedName,
  showDate,
  startsGroup = true,
  endsGroup = true,
  unreadCount = 0,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  content: contentContext,
  onJumpTo,
  onPin,
  onStar,
  onForward,
  pinned = false,
  highlighted = false,
  selecting = false,
  selected = false,
  onSelect,
  selectedIds = [],
}: MessageBubbleProps) => {
  const { message: lead, local } = row;
  // An album is one bubble of several messages. `message` is the one the actions (menu, reply,
  // star, delete, select) work on: the item that was pressed, or the first one.
  const album = row.album;
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const message =
    (album && activeItemId
      ? album.items.find((i) => i.message.message_id === activeItemId)?.message
      : undefined) ?? lead;
  const itemUnder = (target: EventTarget | null): string | null =>
    target instanceof Element
      ? (target.closest(`[${ALBUM_ITEM_ATTR}]`)?.getAttribute(ALBUM_ITEM_ATTR) ?? null)
      : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  // "Translate" in the menu shows the translation under the message (see InlineTranslation).
  const [inlineTranslate, setInlineTranslate] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const aiEnabled = useAiEnabled();
  const [reportOpen, setReportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The link under a finger that held the message, and a counter that replays the heart pop.
  const [heldLink, setHeldLink] = useState<string | null>(null);
  const [heartPops, setHeartPops] = useState(0);
  const [remindOpen, setRemindOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const contact = useContactInfo();
  const isMine = lead.sender_user_id === myId;
  const isSystem = lead.content?.type === 'system';
  const deleted = lead.content === null;
  const settled = !local;
  const time = formatMessageTime(lead.created_at);
  const isBot = isFlickBot(message.sender_user_id, sender);
  const author = isMine ? 'You' : isBot ? 'Flick' : (sender?.display_name ?? 'Someone');
  const editable =
    isMine &&
    settled &&
    message.content &&
    ['text', 'image', 'file'].includes(message.content.type);
  const replyTo = lead.content?.reply_to;
  // A message that is still sending, or was deleted, has no actions.
  const hasActions = settled && !deleted && message.content !== null;
  const openMenu = (): void => {
    if (hasActions) {
      markUsed('message.menu');
      setMenuOpen(true);
    }
  };
  const heart = (): void => {
    const had = message.reactions.some((r) => r.emoji === HEART && r.user_ids.includes(myId));
    haptic();
    onReact(message, HEART);
    if (!had) setHeartPops((n) => n + 1);
  };
  const gestures = useMessageGestures({
    canAct: hasActions,
    selecting,
    onLongPress: (target) => {
      const link = target?.closest('a[href]')?.getAttribute('href');
      if (link) setHeldLink(link);
      else {
        setActiveItemId(itemUnder(target ?? null));
        openMenu();
      }
    },
    onReply: () => {
      onReply(message);
    },
    onHeart: heart,
  });

  // An album shows the reactions and stars of all its items together.
  const shownReactions = album
    ? album.items.reduce<MessageRecord['reactions']>((all, item) => {
        for (const r of item.message.reactions) {
          const known = all.find((x) => x.emoji === r.emoji);
          if (known) {
            known.user_ids = [...new Set([...known.user_ids, ...r.user_ids])];
          } else {
            all.push({ ...r, user_ids: [...r.user_ids] });
          }
        }
        return all;
      }, [])
    : message.reactions;
  const anyStarred = album ? album.items.some((i) => i.message.starred) : message.starred;
  /** The item a tapped reaction chip applies to: the one I reacted on (to undo it), else the first. */
  const reactTarget = (emoji: string): MessageRecord =>
    (album
      ? album.items.find((i) =>
          i.message.reactions.some((r) => r.emoji === emoji && r.user_ids.includes(myId)),
        )?.message
      : undefined) ?? message;

  const dateSeparator = showDate && (
    <div
      className="my-3 flex justify-center"
      role="separator"
      aria-label={formatDateSeparator(lead.created_at)}
    >
      <span
        data-guide="chat.date"
        className="mx-auto w-fit rounded-full bg-base-100/90 px-3 py-1 text-xs font-medium text-[var(--text-2)] shadow-[var(--shadow-1)]"
      >
        {formatDateSeparator(lead.created_at)}
      </span>
    </div>
  );

  const unreadDivider = unreadCount > 0 && (
    <div
      className="my-3 flex items-center gap-3 text-xs font-semibold text-primary-text"
      role="separator"
      data-testid="unread-divider"
    >
      <span className="h-px flex-1 bg-primary/20" aria-hidden="true" />
      {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
      <span className="h-px flex-1 bg-primary/20" aria-hidden="true" />
    </div>
  );

  if (isSystem && message.content) {
    return (
      <div className="pb-1">
        {dateSeparator}
        {unreadDivider}
        <div className="my-2">{renderContent(message.content, contentContext)}</div>
      </div>
    );
  }

  return (
    <div className={cn(startsGroup ? 'pt-2' : 'pt-0.5')}>
      {dateSeparator}
      {unreadDivider}

      <div
        className={cn(
          'group relative flex items-end gap-2 rounded-xl',
          isMine ? 'flex-row-reverse' : 'flex-row',
          selecting && 'cursor-pointer pl-9',
          selected && !album && 'bg-primary/15',
        )}
        aria-label={`${author} at ${time}`}
        role="article"
        // While choosing, a tap anywhere on the message ticks it (and nothing inside it fires).
        onClickCapture={
          selecting && hasActions
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                const itemId = itemUnder(e.target);
                onSelect?.(
                  (album && itemId
                    ? album.items.find((i) => i.message.message_id === itemId)?.message
                    : undefined) ?? lead,
                );
              }
            : undefined
        }
      >
        {selecting && hasActions && !album && (
          <span
            role="checkbox"
            aria-checked={selected}
            aria-label="Select message"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onSelect?.(message);
              }
            }}
            className={cn(
              'absolute left-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full border-2',
              selected
                ? 'border-primary bg-primary text-primary-content'
                : 'border-base-content/40',
            )}
          >
            {selected && <Check className="size-3" aria-hidden="true" />}
          </span>
        )}
        {!isMine &&
          (endsGroup ? (
            isBot ? (
              <FlickAvatar size="xs" />
            ) : isGroup && sender ? (
              <button
                type="button"
                onClick={() => {
                  contact.open(sender);
                }}
                className="shrink-0 rounded-full"
                aria-label={`View ${sender.display_name}'s profile`}
              >
                <Avatar src={sender.avatar_url} name="" size="xs" imgClassName="shadow-none" />
              </button>
            ) : (
              <Avatar src={sender?.avatar_url} name="" size="xs" imgClassName="shadow-none" />
            )
          ) : (
            <span className="size-8 shrink-0" aria-hidden="true" data-testid="avatar-spacer" />
          ))}

        <div
          className={cn(
            'flex max-w-[85%] flex-col sm:max-w-[65%]',
            isMine ? 'items-end' : 'items-start',
          )}
        >
          {!isMine && startsGroup && (isGroup || isBot) && (
            <span
              className={cn(
                'mb-0.5 flex items-center gap-1.5 px-1 text-xs font-semibold',
                !(isGroup && sender) && 'text-primary-text',
              )}
              // In a group each member keeps one colour, so a busy chat is easy to follow.
              style={
                isGroup && sender && !isBot
                  ? { color: senderColor(message.sender_user_id ?? sender.id) }
                  : undefined
              }
            >
              {author}
              {isBot && <FlickBadge />}
            </span>
          )}
          <div className="relative max-w-full">
            {gestures.offset > 0 && (
              <Reply
                className="absolute left-0 top-1/2 size-5 -translate-y-1/2 text-primary-text"
                style={{
                  opacity: gestures.progress,
                  translate: `${String(gestures.offset / 2 - 10)}px 0`,
                }}
                aria-hidden="true"
                data-testid="swipe-reply-arrow"
              />
            )}
            <div
              {...gestures.bubbleProps}
              data-guide="message"
              style={gestures.style}
              onContextMenu={(e) => {
                if (!hasActions || selecting) return;
                e.preventDefault();
                setActiveItemId(itemUnder(e.target));
                markUsed('message.menu');
                // A hold on a link has already opened the link actions; do not stack the menu on it.
                if (heldLink === null) setMenuOpen(true);
              }}
              className={cn(
                'animate-bubble-in relative touch-pan-y overflow-hidden px-3 py-[7px] text-[15px] leading-[22px] transition-opacity [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none sm:px-3.5',
                local?.status === 'pending' && !album && 'opacity-70',
                (highlighted || menuOpen) && 'ring-2 ring-primary',
                album && 'p-1',
                isMine
                  ? cn(
                      'bubble-sent rounded-[18px]',
                      !startsGroup && 'rounded-tr-[6px]',
                      !endsGroup && 'rounded-br-[6px]',
                      endsGroup && (startsGroup ? 'rounded-br-[4px]' : 'rounded-br-[6px]'),
                    )
                  : cn(
                      'bubble-recv rounded-[18px]',
                      !startsGroup && 'rounded-tl-[6px]',
                      !endsGroup && 'rounded-bl-[6px]',
                      endsGroup && (startsGroup ? 'rounded-bl-[4px]' : 'rounded-bl-[6px]'),
                    ),
              )}
            >
              {replyTo && (
                <button
                  type="button"
                  onClick={() => {
                    onJumpTo(replyTo);
                  }}
                  className={cn(
                    'mb-1.5 block w-full rounded-lg border-l-[3px] px-2.5 py-1.5 text-left text-[13px]',
                    isMine
                      ? 'border-white/70 bg-white/15 text-white'
                      : 'border-primary bg-[var(--bg-active)] text-[var(--text-1)]',
                  )}
                  aria-label="Go to the original message"
                >
                  <span className="block font-semibold">{quotedName}</span>
                  <span
                    className={cn(
                      'line-clamp-2 [overflow-wrap:anywhere]',
                      isMine ? 'text-white/90' : 'text-[var(--text-2)]',
                    )}
                  >
                    {quoted ? previewContent(quoted.content) : 'Message'}
                  </span>
                </button>
              )}
              {lead.content?.forwarded && (
                <p className="mb-1 flex items-center gap-1 text-xs italic opacity-90">
                  <Forward className="size-3" aria-hidden="true" />
                  Forwarded
                </p>
              )}
              {deleted ? (
                <p className="text-sm italic opacity-90">
                  {message.deleted_at ? 'This message was deleted' : 'Opened'}
                </p>
              ) : album ? (
                <AlbumGrid
                  group={album}
                  onOpen={contentContext.onOpenImage}
                  selecting={selecting}
                  selectedIds={selectedIds}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                />
              ) : (
                message.content &&
                renderContent(message.content, {
                  ...contentContext,
                  message: {
                    id: message.message_id,
                    conversationId: message.conversation_id,
                    isMine,
                  },
                })
              )}
              {!isMine && !isBot && !deleted && message.content?.type === 'text' && (
                <TranslateChip
                  text={message.content.text}
                  conversationId={message.conversation_id}
                />
              )}
              {!isMine && !isBot && !deleted && message.content?.type === 'text' && (
                <MessageHints
                  conversationId={message.conversation_id}
                  messageId={message.message_id}
                  text={message.content.text}
                />
              )}
              {!isMine && !isBot && !deleted && message.content?.type === 'text' && (
                <AutoTranslated
                  conversationId={message.conversation_id}
                  messageId={message.message_id}
                  text={message.content.text}
                />
              )}
              {inlineTranslate && !deleted && message.content?.type === 'text' && (
                <InlineTranslation
                  messageId={message.message_id}
                  conversationId={message.conversation_id}
                  text={message.content.text}
                  onHide={() => {
                    setInlineTranslate(false);
                  }}
                />
              )}
              {lead.viewed && !deleted && <p className="mt-1 text-xs italic opacity-90">Opened</p>}
              {isBot && message.content?.type === 'text' && message.content.ai_model && (
                <ModelTag
                  label={modelLabel(message.content.ai_provider ?? '', message.content.ai_model)}
                  className="mt-1.5 !text-current opacity-60"
                />
              )}
              {isBot && message.content?.type === 'text' && message.content.ai_sources && (
                <WhyFlickSaid sources={message.content.ai_sources} />
              )}
            </div>
            {heartPops > 0 && (
              <span
                key={heartPops}
                className="pointer-events-none absolute inset-0 z-[2] grid animate-heart-pop place-items-center text-5xl"
                aria-hidden="true"
                data-testid="heart-pop"
              >
                {HEART}
              </span>
            )}
          </div>

          {shownReactions.length > 0 && (
            <div className={cn('-mt-2 flex flex-wrap gap-1 px-2', isMine && 'justify-end')}>
              {shownReactions.map(({ emoji, user_ids }) => {
                const reactedByMe = user_ids.includes(myId);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(reactTarget(emoji), emoji);
                    }}
                    aria-pressed={reactedByMe}
                    className={cn(
                      'relative z-[1] flex h-6 items-center gap-0.5 rounded-full border px-1.5 text-xs shadow-[var(--shadow-1)]',
                      reactedByMe
                        ? 'border-primary/40 bg-[var(--bg-active)]'
                        : 'border-base-content/10 bg-base-100',
                    )}
                    aria-label={`${emoji} ${user_ids.length} ${user_ids.length === 1 ? 'reaction' : 'reactions'}${reactedByMe ? ', including yours. Activate to remove yours' : ''}`}
                  >
                    <span aria-hidden="true">{emoji}</span>
                    {user_ids.length > 1 && (
                      <span className="font-semibold text-[var(--text-2)]">{user_ids.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {!deleted && (
            <NoteChip conversationId={message.conversation_id} messageId={message.message_id} />
          )}

          <div
            className={cn(
              'relative mt-0.5 flex items-center gap-1 px-1 text-[11px] tabular-nums text-[var(--text-2)]',
              isMine && 'flex-row-reverse',
            )}
          >
            <time dateTime={lead.created_at}>{time}</time>
            {lead.edited_at && !deleted && <span className="italic">edited</span>}
            {lead.expires_at && !deleted && (
              <Timer className="size-3.5" role="img" aria-label="Disappearing message" />
            )}
            {anyStarred && !deleted && (
              <Star className="size-3 fill-current text-warning" aria-label="Starred" role="img" />
            )}
            {pinned && <Pin className="size-3 text-primary-text" aria-label="Pinned" role="img" />}
            {!deleted && <ReminderMark messageId={message.message_id} />}
            {isMine && (
              <span data-guide="message.status" className="inline-flex">
                <StatusMark status={status} />
              </span>
            )}

            {local?.status === 'failed' && !album && (
              <span className="flex items-center gap-2 font-semibold text-error">
                {local.error?.message ?? 'Not sent'}
                {local.error?.retryable !== false && (
                  <button
                    type="button"
                    onClick={() => {
                      onRetry(local.client_message_id);
                    }}
                    className="underline"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onDiscard(local.client_message_id);
                  }}
                  className="underline"
                >
                  Discard
                </button>
              </span>
            )}

            {hasActions && !selecting && (
              <button
                type="button"
                onClick={() => {
                  onReply(lead);
                }}
                className="tap-target grid size-7 place-items-center rounded-full text-[var(--text-2)] transition-opacity hover:text-primary-text focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                aria-label="Reply to this message"
              >
                <Reply className="size-4" aria-hidden="true" />
              </button>
            )}

            {hasActions && (
              <button
                type="button"
                onClick={() => {
                  setActiveItemId(null);
                  openMenu();
                }}
                className="tap-target grid size-7 place-items-center rounded-full text-[var(--text-2)] transition-opacity hover:text-primary-text focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                aria-label="Actions for this message"
                aria-haspopup="menu"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
            )}

            {!isMine && (
              <ReportDialog
                target={
                  reportOpen
                    ? { conversation_id: message.conversation_id, message_id: message.message_id }
                    : null
                }
                onClose={() => {
                  setReportOpen(false);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {menuOpen && message.content && (
        <MessageMenu
          onClose={() => {
            setMenuOpen(false);
          }}
          isMine={isMine}
          pinned={pinned}
          starred={message.starred}
          canEdit={Boolean(editable)}
          copyText={message.content.type === 'text' ? message.content.text : null}
          canTranslate={message.content.type === 'text'}
          onReact={(emoji) => {
            haptic();
            onReact(message, emoji);
          }}
          onReply={() => {
            onReply(message);
          }}
          onSelect={
            onSelect &&
            (() => {
              onSelect(message);
            })
          }
          onCopy={(text) => void copyToClipboard(text)}
          onForward={
            onForward &&
            (() => {
              onForward(message);
            })
          }
          onPin={
            onPin &&
            (() => {
              onPin(message);
            })
          }
          onStar={
            onStar &&
            (() => {
              onStar(message);
            })
          }
          onEdit={() => {
            onEdit(message);
          }}
          onTranslate={() => {
            setInlineTranslate(true);
          }}
          onDescribe={
            aiEnabled &&
            (message.content.type === 'image' ||
              message.content.type === 'file' ||
              message.content.type === 'voice')
              ? () => {
                  setDescribeOpen(true);
                }
              : undefined
          }
          onReport={() => {
            setReportOpen(true);
          }}
          onRemind={() => {
            setRemindOpen(true);
          }}
          onBookmark={() => {
            setBookmarkOpen(true);
          }}
          onNote={() => {
            setNoteOpen(true);
          }}
          onEditHistory={
            message.edited_at
              ? () => {
                  setHistoryOpen(true);
                }
              : undefined
          }
          onInfo={
            isMine
              ? () => {
                  setInfoOpen(true);
                }
              : undefined
          }
          onDelete={(scope) => {
            onDelete(message, scope);
          }}
        />
      )}

      {remindOpen && (
        <QuickRemindDialog
          conversationId={message.conversation_id}
          messageId={message.message_id}
          preview={message.content?.type === 'text' ? message.content.text : 'This message'}
          onClose={() => {
            setRemindOpen(false);
          }}
        />
      )}
      {bookmarkOpen && (
        <BookmarkDialog
          messageId={message.message_id}
          onClose={() => {
            setBookmarkOpen(false);
          }}
        />
      )}

      {noteOpen && (
        <NoteDialog
          conversationId={message.conversation_id}
          messageId={message.message_id}
          onClose={() => {
            setNoteOpen(false);
          }}
        />
      )}
      {historyOpen && (
        <EditHistoryDialog
          conversationId={message.conversation_id}
          messageId={message.message_id}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      )}
      {infoOpen && (
        <MessageInfoDialog
          conversationId={message.conversation_id}
          messageId={message.message_id}
          onClose={() => {
            setInfoOpen(false);
          }}
        />
      )}
      {heldLink !== null && (
        <LinkMenu
          href={heldLink}
          onClose={() => {
            setHeldLink(null);
          }}
        />
      )}
      {contact.dialog}

      {(message.content?.type === 'image' ||
        message.content?.type === 'file' ||
        message.content?.type === 'voice') && (
        <DescribeImageDialog
          attachmentId={message.content.attachment_id}
          conversationId={message.conversation_id}
          open={describeOpen}
          onClose={() => {
            setDescribeOpen(false);
          }}
        />
      )}
      {message.content?.type === 'text' && (
        <TranslateDialog
          text={message.content.text}
          conversationId={message.conversation_id}
          open={translateOpen}
          onClose={() => {
            setTranslateOpen(false);
          }}
        />
      )}
    </div>
  );
};

export const MessageBubble = memo(MessageBubbleImpl);

/** The "typing…" / "recording audio…" row at the end of the list. */
export const ActivityBubble = ({
  avatar,
  label,
}: {
  avatar: string | null | undefined;
  label: string;
}) => (
  <div className="flex items-end gap-2 pb-1" aria-label={label} role="status">
    <Avatar src={avatar} name="" size="xs" imgClassName="ring-2 ring-primary/15 shadow-sm" />
    <div className="bubble-recv flex items-center gap-2 rounded-[18px] rounded-bl-[6px] px-4 py-3">
      <span className="flex items-center gap-1" aria-hidden="true">
        {['0ms', '150ms', '300ms'].map((delay) => (
          <span
            key={delay}
            className="size-2 animate-bounce rounded-full bg-[var(--text-3)]"
            style={{ animationDelay: delay, animationDuration: '1s' }}
          />
        ))}
      </span>
      <span className="text-xs text-[var(--text-2)]">{label}</span>
    </div>
  </div>
);
