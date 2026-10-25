import { memo, useState } from 'react';
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
import { modelLabel } from '@/features/ai/modelLabel';
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
      return <CheckCheck className="size-3.5 text-primary" aria-label="Read" role="img" />;
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
}: MessageBubbleProps) => {
  const { message, local } = row;
  const [menuOpen, setMenuOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // The link under a finger that held the message, and a counter that replays the heart pop.
  const [heldLink, setHeldLink] = useState<string | null>(null);
  const [heartPops, setHeartPops] = useState(0);
  const contact = useContactInfo();
  const isMine = message.sender_user_id === myId;
  const isSystem = message.content?.type === 'system';
  const deleted = message.content === null;
  const settled = !local;
  const time = formatMessageTime(message.created_at);
  const isBot = isFlickBot(message.sender_user_id, sender);
  const author = isMine ? 'You' : isBot ? 'Flick' : (sender?.display_name ?? 'Someone');
  const editable =
    isMine &&
    settled &&
    message.content &&
    ['text', 'image', 'file'].includes(message.content.type);
  const replyTo = message.content?.reply_to;
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
      else openMenu();
    },
    onReply: () => {
      onReply(message);
    },
    onHeart: heart,
  });

  const dateSeparator = showDate && (
    <div
      className="my-5 flex justify-center"
      role="separator"
      aria-label={formatDateSeparator(message.created_at)}
    >
      <span
        data-guide="chat.date"
        className="chip text-[11px] font-semibold uppercase tracking-wider"
      >
        {formatDateSeparator(message.created_at)}
      </span>
    </div>
  );

  const unreadDivider = unreadCount > 0 && (
    <div
      className="my-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-primary"
      role="separator"
      data-testid="unread-divider"
    >
      <span className="h-px flex-1 bg-primary/30" aria-hidden="true" />
      {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
      <span className="h-px flex-1 bg-primary/30" aria-hidden="true" />
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
    <div className={cn(endsGroup ? 'pb-1' : 'pb-0.5', startsGroup && 'pt-1')}>
      {dateSeparator}
      {unreadDivider}

      <div
        className={cn(
          'group relative flex items-end gap-2 rounded-xl',
          isMine ? 'flex-row-reverse' : 'flex-row',
          selecting && 'cursor-pointer pl-9',
          selected && 'bg-primary/15',
        )}
        aria-label={`${author} at ${time}`}
        role="article"
        // While choosing, a tap anywhere on the message ticks it (and nothing inside it fires).
        onClickCapture={
          selecting && hasActions
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelect?.(message);
              }
            : undefined
        }
      >
        {selecting && hasActions && (
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
                <Avatar
                  src={sender.avatar_url}
                  name=""
                  size="xs"
                  imgClassName="ring-2 ring-primary/15 shadow-sm"
                />
              </button>
            ) : (
              <Avatar
                src={sender?.avatar_url}
                name=""
                size="xs"
                imgClassName="ring-2 ring-primary/15 shadow-sm"
              />
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
                !(isGroup && sender) && 'text-primary',
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
                className="absolute left-0 top-1/2 size-5 -translate-y-1/2 text-primary"
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
                markUsed('message.menu');
                // A hold on a link has already opened the link actions; do not stack the menu on it.
                if (heldLink === null) setMenuOpen(true);
              }}
              className={cn(
                'animate-bubble-in relative touch-pan-y overflow-hidden px-3.5 py-2.5 shadow-sm transition-opacity [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none',
                local?.status === 'pending' && 'opacity-70',
                (highlighted || menuOpen) && 'ring-2 ring-primary',
                isMine
                  ? 'bubble-sent rounded-2xl rounded-br-md'
                  : 'bubble-recv rounded-2xl rounded-bl-md',
              )}
            >
              {replyTo && (
                <button
                  type="button"
                  onClick={() => {
                    onJumpTo(replyTo);
                  }}
                  className="mb-1.5 block w-full rounded-lg border-l-4 border-current/40 bg-black/10 px-2 py-1 text-left text-xs opacity-80"
                  aria-label="Go to the original message"
                >
                  <span className="block font-semibold">{quotedName}</span>
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">
                    {quoted ? previewContent(quoted.content) : 'Message'}
                  </span>
                </button>
              )}
              {message.content?.forwarded && (
                <p className="mb-1 flex items-center gap-1 text-xs italic opacity-70">
                  <Forward className="size-3" aria-hidden="true" />
                  Forwarded
                </p>
              )}
              {deleted ? (
                <p className="text-sm italic opacity-70">
                  {message.deleted_at ? 'This message was deleted' : 'Opened'}
                </p>
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
              {message.viewed && !deleted && (
                <p className="mt-1 text-xs italic opacity-70">Opened</p>
              )}
              {isBot && message.content?.type === 'text' && message.content.ai_model && (
                <ModelTag
                  label={modelLabel(message.content.ai_provider ?? '', message.content.ai_model)}
                  className="mt-1.5 !text-current opacity-60"
                />
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

          {message.reactions.length > 0 && (
            <div className={cn('-mt-1.5 flex flex-wrap gap-1 px-1', isMine && 'justify-end')}>
              {message.reactions.map(({ emoji, user_ids }) => {
                const reactedByMe = user_ids.includes(myId);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(message, emoji);
                    }}
                    aria-pressed={reactedByMe}
                    className={cn(
                      'relative z-[1] flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs shadow-sm',
                      reactedByMe
                        ? 'border-primary/50 bg-primary/15'
                        : 'border-base-content/10 bg-base-100',
                    )}
                    aria-label={`${emoji} ${user_ids.length} ${user_ids.length === 1 ? 'reaction' : 'reactions'}${reactedByMe ? ', including yours. Activate to remove yours' : ''}`}
                  >
                    <span aria-hidden="true">{emoji}</span>
                    {user_ids.length > 1 && (
                      <span className="font-semibold text-base-content/70">{user_ids.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div
            className={cn(
              'relative mt-1 flex items-center gap-1 px-1 text-[11px] text-base-content/60',
              isMine && 'flex-row-reverse',
            )}
          >
            <time dateTime={message.created_at}>{time}</time>
            {message.edited_at && !deleted && <span className="italic">edited</span>}
            {message.expires_at && !deleted && (
              <Timer className="size-3.5" role="img" aria-label="Disappearing message" />
            )}
            {message.starred && !deleted && (
              <Star className="size-3 fill-current text-warning" aria-label="Starred" role="img" />
            )}
            {pinned && <Pin className="size-3 text-primary" aria-label="Pinned" role="img" />}
            {isMine && (
              <span data-guide="message.status" className="inline-flex">
                <StatusMark status={status} />
              </span>
            )}

            {local?.status === 'failed' && (
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
                  onReply(message);
                }}
                className="tap-target grid size-6 place-items-center rounded-full transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                aria-label="Reply to this message"
              >
                <Reply className="size-4" aria-hidden="true" />
              </button>
            )}

            {hasActions && (
              <button
                type="button"
                onClick={openMenu}
                className="tap-target grid size-6 place-items-center rounded-full transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
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
            setTranslateOpen(true);
          }}
          onReport={() => {
            setReportOpen(true);
          }}
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

      {message.content?.type === 'text' && (
        <TranslateDialog
          text={message.content.text}
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
    <div className="bubble-recv flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3">
      <span className="flex items-center gap-1" aria-hidden="true">
        {['0ms', '150ms', '300ms'].map((delay) => (
          <span
            key={delay}
            className="size-2 animate-bounce rounded-full bg-base-content/40"
            style={{ animationDelay: delay, animationDuration: '1s' }}
          />
        ))}
      </span>
      <span className="text-xs text-base-content/60">{label}</span>
    </div>
  </div>
);
