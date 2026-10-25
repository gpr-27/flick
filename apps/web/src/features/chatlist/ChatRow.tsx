// One chat in the list, drawn as a rounded card, with WhatsApp-style swipe buttons behind it.
//
// Accessibility: the card is the list option. The buttons behind it and the "⋮" are for pointer
// users (a button inside an option would break the listbox), so they are hidden from screen
// readers and out of the tab order. The same actions are in the row menu, which opens with the
// context-menu key, Shift+F10, a right-click or the "⋮", and in select mode.
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
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
  Pin,
  PinOff,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Avatar, Badge, cn, formatCount } from '@/components/ui';
import { FlickAvatar, FlickBadge } from '@/features/ai/FlickBadge';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { formatRelativeTime } from '@/lib/time';
import { previewContent } from '../chat/content/registry';
import { conversationAvatar, conversationTitle } from '../chat/conversationView';
import { useLongPress } from '../chat/useLongPress';
import { useMentions } from '../notifications/mentions';
import { useDraftStore } from '../organise/drafts';
import { useIsHidden } from '../organise/lock';
import { isMuted } from '../organise/prefs';
import { PreviewIcon } from './previewIcon';
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
  onFocus: () => void;
  /** Run a swipe/menu action (the Sidebar owns the dialogs some of them open). */
  onAction: (id: ActionId, c: ConversationSummary) => void;
}

export const ChatRow = ({
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
    else onSelect(c.id);
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
      onClick={activate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // A long press on a phone also sends this event; there it starts select mode instead.
        e.preventDefault();
        if ((e.nativeEvent as { pointerType?: string }).pointerType !== 'touch') setMenuOpen(true);
      }}
      {...merged}
      style={{ touchAction: 'pan-y' }}
      className="group relative mb-2 select-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="relative overflow-hidden rounded-2xl">
        {swipe.revealed && (
          <ActionStrip conversation={c} side={swipe.revealed} onAction={onAction} />
        )}

        <div
          style={{
            transform: moving ? `translateX(${swipe.offset}px)` : undefined,
            transition: motion ? 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
          }}
          className={cn(
            'relative flex min-h-[64px] w-full cursor-pointer items-center gap-3 rounded-2xl border p-2.5 text-left shadow-sm backdrop-blur-md transition-colors duration-200',
            moving ? 'bg-base-100' : 'bg-base-100/70',
            isActive && !selecting
              ? 'border-primary/40 bg-primary/10 ring-1 ring-primary/30'
              : 'border-base-content/10 hover:bg-base-100',
            ticked && 'border-primary/50 bg-primary/10',
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
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  unread > 0 || manualUnread ? 'font-bold' : 'font-semibold',
                )}
              >
                <span className="truncate">{name}</span>
                {bot && <FlickBadge />}
              </span>
              {last && (
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-medium',
                    unread > 0 || manualUnread ? 'text-primary' : 'text-base-content/60',
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
                    <span className="shrink-0 font-semibold text-primary">Draft:</span>
                    <span className="truncate">{draft}</span>
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

              <span className="flex shrink-0 items-center gap-1.5 text-base-content/50">
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
            'absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-base-100/90 text-base-content/70 opacity-0 shadow transition-opacity hover:text-primary',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
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
