// One chat in the list, drawn as a rounded card, with WhatsApp-style swipe buttons behind it.
//
// Accessibility: the card is the list option. The buttons behind it and the "⋮" are for pointer
// users (a button inside an option would break the listbox), so they are hidden from screen
// readers and out of the tab order. The same actions are in the row menu, which opens with the
// context-menu key, Shift+F10, a right-click or the "⋮", and in select mode.
import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Bell,
  Check,
  CheckCheck,
  Lock,
  MailOpen,
  MoreVertical,
  Phone,
  Pin,
  PinOff,
  Star,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, Badge, cn, formatCount } from '@/components/ui';
import { FlickAvatar, FlickBadge } from '@/features/ai/FlickBadge';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { useCallStore } from '@/features/calls/useCallStore';
import { markUsed } from '@/features/guide/useGuideStore';
import { formatRelativeTime } from '@/lib/time';
import { previewContent } from '../chat/content/registry';
import { conversationAvatar, conversationTitle } from '../chat/conversationView';
import { useLongPress } from '../chat/useLongPress';
import { useMentions } from '../notifications/mentions';
import { useDraftStore } from '../organise/drafts';
import { useIsHidden } from '../organise/lock';
import { isMuted } from '../organise/prefs';
import { PreviewIcon } from './previewIcon';
import { TagDots } from '../lists/TagDots';
import { RowMenu } from './RowMenu';
import {
  actionIdsFor,
  describeAction,
  isUnread,
  longSwipeAction,
  type ActionId,
} from './rowActions';
import { BUTTON_PX, openWidth } from './swipeGesture';
import { useOpenRow } from './useOpenRow';
import { useSelection } from './useSelection';
import { prefersReducedMotion, useSwipeRow } from './useSwipeRow';

const ACTION_STYLE: Record<ActionId, string> = {
  read: 'bg-info text-info-content',
  pin: 'bg-primary text-primary-content',
  mute: 'bg-neutral text-neutral-content',
  archive: 'bg-warning text-warning-content',
  delete: 'bg-error text-error-content',
};

const actionIcon = (id: ActionId, c: ConversationSummary): LucideIcon => {
  switch (id) {
    case 'read':
      return isUnread(c) ? CheckCheck : MailOpen;
    case 'pin':
      return c.prefs.pinned ? PinOff : Pin;
    case 'mute':
      return isMuted(c.prefs) ? Bell : BellOff;
    case 'archive':
      return c.prefs.archived ? ArchiveRestore : Archive;
    case 'delete':
      return Trash2;
  }
};

export interface ChatRowProps {
  conversation: ConversationSummary;
  myId: string | undefined;
  isOnline: boolean;
  isActive: boolean;
  isFocusTarget: boolean;
  onSelect: (id: string) => void;
  /** Called with the row's chat id (one stable callback for every row, so rows can be memoized). */
  onFocus: (id: string) => void;
  /** Run a swipe/menu action (the Sidebar owns the dialogs some of them open). */
  onAction: (id: ActionId, c: ConversationSummary) => void;
}

const ChatRowImpl = ({
  conversation: c,
  myId,
  isOnline,
  isActive,
  isFocusTarget,
  onSelect,
  onFocus,
  onAction,
}: ChatRowProps) => {
  const unread = c.unread_count;
  const last = c.last_message;
  const prefix = last && last.sender_user_id === myId ? 'You: ' : '';
  const draft = useDraftStore((s) => s.drafts[c.id]);
  // A locked chat shows no message text until its passcode is entered in this tab.
  const hidden = useIsHidden(c.id, c.prefs.locked);
  const muted = isMuted(c.prefs);
  const mentioned = useMentions((s) => c.id in s.chats);
  const bot = isFlickChat(c);
  const name = conversationTitle(c);
  const manualUnread = c.prefs.marked_unread && unread === 0;

  const initiateCall = useCallStore((s) => s.initiateCall);
  const callsDisabled = useCallStore((s) => s.callStatus !== 'idle');
  // Phones get small call buttons at the end of a person-to-person row (not for Flick, your own
  // notes or a locked chat).
  const peer = c.peer;
  const callable = c.type === 'direct' && Boolean(peer) && !bot && !c.is_saved && !hidden;

  const selecting = useSelection((s) => s.active);
  const ticked = useSelection((s) => s.ids.includes(c.id));

  const rowRef = useRef<HTMLLIElement>(null);
  const menuAnchor = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const swipe = useSwipeRow({
    id: c.id,
    rowRef,
    disabled: selecting,
    onTrigger: (side) => {
      onAction(longSwipeAction(c, side), c);
    },
  });
  const press = useLongPress(() => {
    swipe.cancel();
    useOpenRow.getState().close();
    useSelection.getState().begin(c.id);
  });

  const activate = (): void => {
    if (selecting) useSelection.getState().toggle(c.id);
    else {
      if (bot) markUsed('ai.flickchat');
      onSelect(c.id);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      setMenuOpen(true);
    } else if (e.key === 'Delete' && e.target === e.currentTarget) {
      e.preventDefault();
      onAction('delete', c);
    }
  };

  const merged = {
    onPointerDown: (e: PointerEvent) => {
      if (!selecting) press.onPointerDown(e);
      swipe.handlers.onPointerDown(e);
    },
    onPointerMove: (e: PointerEvent) => {
      press.onPointerMove(e);
      swipe.handlers.onPointerMove(e);
    },
    onPointerUp: (e: PointerEvent) => {
      press.onPointerUp();
      swipe.handlers.onPointerUp(e);
    },
    onPointerCancel: (e: PointerEvent) => {
      press.onPointerCancel();
      swipe.handlers.onPointerCancel(e);
    },
    onPointerLeave: () => {
      press.onPointerLeave();
    },
    onClickCapture: (e: MouseEvent) => {
      press.onClickCapture(e);
      if (!e.isPropagationStopped()) swipe.handlers.onClickCapture(e);
    },
  };

  const moving = swipe.offset !== 0;
  const motion = !swipe.dragging && !prefersReducedMotion();

  return (
    <li
      ref={rowRef}
      role="option"
      aria-selected={selecting ? ticked : isActive}
      tabIndex={isFocusTarget ? 0 : -1}
      data-conversation-id={c.id}
      data-guide={bot ? 'flick-chat' : undefined}
      onClick={activate}
      onFocus={() => {
        onFocus(c.id);
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // A long press on a phone also sends this event; there it starts select mode instead.
        e.preventDefault();
        if ((e.nativeEvent as { pointerType?: string }).pointerType !== 'touch') setMenuOpen(true);
      }}
      {...merged}
      style={{
        touchAction: 'pan-y',
        // Rows off screen are not laid out or painted; 72px is the row's minimum height.
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 72px',
      }}
      className="group relative select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
    >
      <div className="relative overflow-hidden">
        {swipe.revealed && (
          <ActionStrip conversation={c} side={swipe.revealed} onAction={onAction} />
        )}

        <div
          style={{
            transform: moving ? `translateX(${swipe.offset}px)` : undefined,
            transition: motion ? 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
          }}
          className={cn(
            'relative flex min-h-[72px] w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150',
            isActive && !selecting
              ? 'bg-[var(--bg-active,oklch(var(--p)/0.1))]'
              : moving
                ? 'bg-base-100'
                : 'bg-base-100 [@media(hover:hover)]:hover:bg-[var(--bg-hover,oklch(var(--bc)/0.05))]',
            ticked && 'bg-[var(--bg-active,oklch(var(--p)/0.1))]',
          )}
        >
          {selecting && (
            <span
              aria-hidden="true"
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full border-2',
                ticked
                  ? 'border-primary bg-primary text-primary-content'
                  : 'border-base-content/30',
              )}
            >
              {ticked && <Check className="size-4" />}
            </span>
          )}
          {bot ? (
            <FlickAvatar size="md" />
          ) : (
            <Avatar src={conversationAvatar(c)} name="" size="md" online={isOnline} />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  unread > 0 || manualUnread ? 'text-base font-semibold' : 'text-base font-medium',
                )}
              >
                <span className="truncate">{name}</span>
                <TagDots conversationId={c.id} />
                {bot && <FlickBadge />}
              </span>
              {last && (
                <span
                  className={cn(
                    'shrink-0 text-xs tabular-nums',
                    unread > 0 || manualUnread
                      ? 'font-semibold text-primary-text'
                      : 'text-[var(--text-2,oklch(var(--bc)/0.65))]',
                  )}
                >
                  {formatRelativeTime(last.created_at)}
                </span>
              )}
            </div>

            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1 truncate text-sm',
                  unread > 0 ? 'text-base-content' : 'text-[var(--text-2,oklch(var(--bc)/0.65))]',
                )}
              >
                {hidden ? (
                  <span className="flex items-center gap-1 italic">
                    <Lock className="size-3.5" aria-hidden="true" />
                    Locked chat
                  </span>
                ) : draft && !isActive ? (
                  <>
                    <span className="shrink-0 font-semibold text-primary">Draft:</span>
                    <span className="truncate">{stripMarkdown(draft)}</span>
                  </>
                ) : last ? (
                  <>
                    {prefix && <span className="shrink-0">{prefix}</span>}
                    <PreviewIcon content={last.content} />
                    <span className="truncate">{previewContent(last.content)}</span>
                  </>
                ) : (
                  <span className="italic text-base-content/55">Tap to start chatting</span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-1.5 text-[var(--text-2,oklch(var(--bc)/0.65))]">
                {muted && <BellOff className="size-3.5" aria-label="Muted" role="img" />}
                {(c.prefs.pinned || bot) && (
                  <Pin className="size-3.5" aria-label="Pinned" role="img" />
                )}
                {c.prefs.favorite && (
                  <Star className="size-3.5" aria-label="Favourite" role="img" />
                )}
                {mentioned && unread > 0 && (
                  <Badge variant="count" label="You were mentioned">
                    @
                  </Badge>
                )}
                {unread > 0 && (
                  <Badge variant="count" label={`${unread} unread`}>
                    {formatCount(unread)}
                  </Badge>
                )}
                {manualUnread && (
                  <span
                    role="img"
                    aria-label="Marked as unread"
                    className="size-2.5 rounded-full bg-primary"
                  />
                )}
              </span>
            </div>
          </div>

          {callable && peer && !selecting && (
            // Phones only. Like the swipe buttons these are for pointer users: hidden from screen
            // readers (a button inside a listbox option would break it; the chat header has the
            // same calls) and out of the tab order. `data-swipe-action` keeps taps on them from
            // being treated as a swipe or a row tap.
            <span
              aria-hidden="true"
              data-swipe-action
              className="flex shrink-0 items-center sm:hidden"
            >
              {(['audio', 'video'] as const).map((type) => (
                <span
                  key={type}
                  data-testid={`row-${type}-call`}
                  title={type === 'video' ? 'Video call' : 'Voice call'}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (callsDisabled) return;
                    markUsed(type === 'video' ? 'calls.video' : 'calls.voice');
                    void initiateCall(c.id, peer, type);
                  }}
                  className={cn(
                    'grid size-10 cursor-pointer place-items-center rounded-full text-[var(--text-2,oklch(var(--bc)/0.65))] [@media(hover:hover)]:hover:text-primary active:bg-primary/10',
                    callsDisabled && 'pointer-events-none opacity-40',
                  )}
                >
                  {type === 'video' ? (
                    <Video className="size-[18px]" />
                  ) : (
                    <Phone className="size-[18px]" />
                  )}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {
        <span
          ref={menuAnchor}
          aria-hidden="true"
          data-swipe-action
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
          }}
          className={cn(
            'absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-base-100 text-[var(--text-2,oklch(var(--bc)/0.65))] opacity-0 shadow-md ring-1 ring-base-content/10 transition-opacity [@media(hover:hover)]:hover:text-primary',
            '[@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:opacity-100',
            '[@media(hover:none)]:pointer-events-none [@media(hover:none)]:hidden',
            selecting && 'pointer-events-none hidden',
          )}
        >
          <MoreVertical className="size-5" />
        </span>
      }
      {menuOpen && (
        <RowMenu
          conversation={c}
          anchor={menuAnchor}
          onAction={(id) => {
            onAction(id, c);
          }}
          onSelect={() => {
            useSelection.getState().begin(c.id);
          }}
          onClose={() => {
            setMenuOpen(false);
            rowRef.current?.focus();
          }}
        />
      )}
    </li>
  );
};

/** The buttons uncovered by swiping. Decorative for screen readers: see the file header. */
const ActionStrip = ({
  conversation: c,
  side,
  onAction,
}: {
  conversation: ConversationSummary;
  side: 'start' | 'end';
  onAction: (id: ActionId, c: ConversationSummary) => void;
}) => {
  const ids = actionIdsFor(c, side);
  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute inset-0 flex bg-base-300',
        side === 'start' ? 'justify-start' : 'justify-end',
      )}
    >
      <div
        className="flex h-full"
        style={{ width: Math.min(openWidth(side), ids.length * BUTTON_PX) }}
      >
        {ids.map((id) => {
          const action = describeAction(id, c);
          const Icon = actionIcon(id, c);
          return (
            <button
              key={id}
              type="button"
              tabIndex={-1}
              data-swipe-action
              aria-label={action.ariaLabel}
              onClick={(e) => {
                e.stopPropagation();
                useOpenRow.getState().close();
                onAction(id, c);
              }}
              className={cn(
                'flex h-full flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                ACTION_STYLE[id],
              )}
            >
              <Icon className="size-5" />
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Memoized: scrolling or hovering one row, or opening another, must not re-render the others. */
export const ChatRow = memo(ChatRowImpl);
