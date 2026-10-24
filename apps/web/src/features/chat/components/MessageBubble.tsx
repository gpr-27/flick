import { memo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Flag,
  Forward,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
  Timer,
  Star,
  Trash2,
} from 'lucide-react';
import type { MessageRecord, UserSummary } from '@chat/contracts';
import { Avatar, cn } from '@/components/ui';
import { FlickBadge } from '@/features/ai/FlickBadge';
import { isFlickBot } from '@/features/ai/isFlickBot';
import { TranslateButton } from '@/features/ai/TranslateButton';
import { ReportDialog } from '@/features/settings/components/ReportDialog';
import { formatDateSeparator, formatMessageTime } from '@/lib/time';
import { renderContent, previewContent, type ContentContext } from '../content/registry';
import type { RowStatus, ThreadRow } from '../threadRows';
import { ReactionPicker } from './ReactionPicker';

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
  pickerOpen: boolean;
  onTogglePicker: (messageId: string | null) => void;
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
}

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

const iconButton = 'hover:text-primary focus-visible:text-primary';

const MessageBubbleImpl = ({
  row,
  myId,
  sender,
  isGroup,
  status,
  quoted,
  quotedName,
  showDate,
  pickerOpen,
  onTogglePicker,
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
}: MessageBubbleProps) => {
  const { message, local } = row;
  const [deleteMenu, setDeleteMenu] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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

  const dateSeparator = showDate && (
    <div
      className="my-5 flex justify-center"
      role="separator"
      aria-label={formatDateSeparator(message.created_at)}
    >
      <span className="chip text-[11px] font-semibold uppercase tracking-wider">
        {formatDateSeparator(message.created_at)}
      </span>
    </div>
  );

  if (isSystem && message.content) {
    return (
      <div className="pb-1">
        {dateSeparator}
        <div className="my-2">{renderContent(message.content, contentContext)}</div>
      </div>
    );
  }

  return (
    <div className="pb-1">
      {dateSeparator}

      <div
        className={cn('group flex items-end gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}
        aria-label={`${author} at ${time}`}
        role="article"
      >
        {!isMine && (
          <Avatar
            src={sender?.avatar_url}
            name=""
            size="xs"
            imgClassName="ring-2 ring-primary/15 shadow-sm"
          />
        )}

        <div
          className={cn(
            'flex max-w-[75%] flex-col sm:max-w-[65%]',
            isMine ? 'items-end' : 'items-start',
          )}
        >
          {!isMine && (isGroup || isBot) && (
            <span className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-primary">
              {author}
              {isBot && <FlickBadge />}
            </span>
          )}
          <div
            className={cn(
              'animate-bubble-in overflow-hidden px-3.5 py-2.5 shadow-sm transition-opacity',
              local?.status === 'pending' && 'opacity-70',
              highlighted && 'ring-2 ring-primary',
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
                <span className="line-clamp-2 break-words">
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
            {message.viewed && <p className="mt-1 text-xs italic opacity-70">Opened</p>}
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
            {isMine && <StatusMark status={status} />}

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

            {settled && !deleted && (
              <div
                className={cn(
                  'flex items-center gap-1.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-70',
                  pickerOpen || deleteMenu || translateOpen ? 'opacity-100' : 'opacity-0',
                  isMine && 'flex-row-reverse',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onTogglePicker(pickerOpen ? null : message.message_id);
                  }}
                  className={iconButton}
                  aria-label="React to message"
                  aria-expanded={pickerOpen}
                >
                  <SmilePlus className="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onReply(message);
                  }}
                  className={iconButton}
                  aria-label="Reply to message"
                >
                  <Reply className="size-3.5" aria-hidden="true" />
                </button>
                {onStar && (
                  <button
                    type="button"
                    onClick={() => {
                      onStar(message);
                    }}
                    className={iconButton}
                    aria-label={message.starred ? 'Unstar message' : 'Star message'}
                    aria-pressed={message.starred}
                  >
                    <Star className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {onPin && (
                  <button
                    type="button"
                    onClick={() => {
                      onPin(message);
                    }}
                    className={iconButton}
                    aria-label={pinned ? 'Unpin message' : 'Pin message'}
                    aria-pressed={pinned}
                  >
                    <Pin className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {onForward && (
                  <button
                    type="button"
                    onClick={() => {
                      onForward(message);
                    }}
                    className={iconButton}
                    aria-label="Forward message"
                  >
                    <Forward className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {message.content?.type === 'text' && (
                  <TranslateButton
                    text={message.content.text}
                    open={translateOpen}
                    onOpenChange={setTranslateOpen}
                    align={isMine ? 'right' : 'left'}
                  />
                )}
                {!isMine && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportOpen(true);
                    }}
                    className={iconButton}
                    aria-label="Report message"
                  >
                    <Flag className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {editable && (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(message);
                    }}
                    className={iconButton}
                    aria-label="Edit message"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDeleteMenu((open) => !open);
                  }}
                  className="hover:text-error focus-visible:text-error"
                  aria-label="Delete message"
                  aria-expanded={deleteMenu}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
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

            {deleteMenu && (
              <div
                role="menu"
                aria-label="Delete options"
                className={cn(
                  'glass-card absolute bottom-full z-20 mb-1 flex w-max flex-col rounded-xl border border-base-content/10 p-1 text-sm shadow-xl',
                  isMine ? 'right-0' : 'left-0',
                )}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="rounded-lg px-3 py-1.5 text-left hover:bg-base-200"
                  onClick={() => {
                    setDeleteMenu(false);
                    onDelete(message, 'me');
                  }}
                >
                  Delete for me
                </button>
                {isMine && (
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded-lg px-3 py-1.5 text-left text-error hover:bg-base-200"
                    onClick={() => {
                      setDeleteMenu(false);
                      onDelete(message, 'everyone');
                    }}
                  >
                    Delete for everyone
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="rounded-lg px-3 py-1.5 text-left hover:bg-base-200"
                  onClick={() => {
                    setDeleteMenu(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {pickerOpen && (
              <ReactionPicker
                align={isMine ? 'right' : 'left'}
                onPick={(emoji) => {
                  onReact(message, emoji);
                }}
                onClose={() => {
                  onTogglePicker(null);
                }}
              />
            )}
          </div>
        </div>
      </div>
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
