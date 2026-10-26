import { useEffect, useState, type ReactNode } from 'react';
import {
  AlarmClock,
  Bookmark,
  Copy,
  Volume2,
  Flag,
  Forward,
  Info,
  Languages,
  CheckSquare,
  History,
  Pencil,
  StickyNote,
  Pin,
  PinOff,
  Reply,
  Star,
  Trash2,
} from 'lucide-react';
import { Modal, cn } from '@/components/ui';
import { useSheetSwipeDown } from '../gestures/useSheetSwipeDown';
import { REACTIONS } from '../reactions';
import { canReadAloud, isReading, toggleReadAloud } from '../../platform/readAloud';

export interface MessageMenuProps {
  onClose: () => void;
  isMine: boolean;
  pinned: boolean;
  starred: boolean;
  canEdit: boolean;
  /** The text to copy, or null when the message has none (a photo, a poll). */
  copyText: string | null;
  canTranslate: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  /** Shown only when given: start choosing several messages with this one. */
  onSelect?: () => void;
  onCopy: (text: string) => void;
  onForward?: () => void;
  onPin?: () => void;
  onStar?: () => void;
  onEdit: () => void;
  onTranslate: () => void;
  /** Shown only when given (photos, PDFs, files, voice notes): "Explain with Flick". */
  onDescribe?: (() => void) | undefined;
  onReport: () => void;
  /** Shown only when given: delivered/read details for my own message. */
  onInfo?: () => void;
  /** Shown only when given: "Remind me" about this message. */
  onRemind?: () => void;
  /** Shown only when given: "Bookmark…" into a named collection. */
  onBookmark?: () => void;
  /** Shown only when given: add or change my private note. */
  onNote?: () => void;
  /** Shown only when given: earlier versions of an edited message. */
  onEditHistory?: () => void;
  onDelete: (scope: 'me' | 'everyone') => void;
}

const row =
  'flex min-h-[48px] w-full items-center gap-4 rounded-xl px-4 text-left text-base active:bg-base-200 hover:bg-base-200';

const Item = ({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={cn(row, danger && 'text-error')}
  >
    {icon && <span aria-hidden="true">{icon}</span>}
    {children}
  </button>
);

/**
 * The actions for one message, opened by holding it (or right-click / the small arrow on
 * desktop). A bottom sheet on phones so every button is thumb-sized; a small card on wide screens.
 * Mount it only while open: closing unmounts it, which also resets the delete step.
 */
export const MessageMenu = (props: MessageMenuProps) => {
  const { onClose } = props;
  const [step, setStep] = useState<'actions' | 'delete'>('actions');
  const sheet = useSheetSwipeDown(onClose);
  // The menu appears right under the finger that is still holding the message. Ignoring touches
  // for a moment keeps the lift of that finger from tapping an emoji or an action by accident.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReady(true);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  // Every action closes the menu first, so a slow action never leaves it hanging open.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Modal
      open
      onClose={onClose}
      label="Message actions"
      overlayClassName={cn('max-sm:items-end sm:p-4', !ready && 'pointer-events-none')}
      className="w-full sm:w-80"
    >
      <div
        {...sheet.props}
        style={sheet.style}
        className="glass-card flex touch-pan-x flex-col gap-1 rounded-t-3xl border border-base-content/10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
      >
        <div
          className="mx-auto mb-1 h-1 w-10 rounded-full bg-base-content/20 sm:hidden"
          aria-hidden="true"
        />

        {step === 'actions' ? (
          <>
            <div
              role="toolbar"
              aria-label="React to message"
              className="grid grid-cols-8 gap-0.5 px-1 pb-1"
            >
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={run(() => {
                    props.onReact(emoji);
                  })}
                  className="grid aspect-square min-h-10 place-items-center rounded-full text-2xl active:scale-110 active:bg-base-200"
                  aria-label={`React ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div role="menu" aria-label="Message actions" className="flex flex-col">
              <Item icon={<Reply className="size-5" />} onClick={run(props.onReply)}>
                Reply
              </Item>
              {props.onSelect && (
                <Item icon={<CheckSquare className="size-5" />} onClick={run(props.onSelect)}>
                  Select
                </Item>
              )}
              {props.copyText !== null && (
                <Item
                  icon={<Copy className="size-5" />}
                  onClick={run(() => {
                    props.onCopy(props.copyText ?? '');
                  })}
                >
                  Copy
                </Item>
              )}
              {props.copyText !== null && canReadAloud() && (
                <Item
                  icon={<Volume2 className="size-5" />}
                  onClick={run(() => {
                    toggleReadAloud(props.copyText ?? '');
                  })}
                >
                  {isReading() ? 'Stop reading' : 'Read aloud'}
                </Item>
              )}
              {props.onForward && (
                <Item icon={<Forward className="size-5" />} onClick={run(props.onForward)}>
                  Forward
                </Item>
              )}
              {props.onPin && (
                <Item
                  icon={props.pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />}
                  onClick={run(props.onPin)}
                >
                  {props.pinned ? 'Unpin' : 'Pin'}
                </Item>
              )}
              {props.onStar && (
                <Item
                  icon={<Star className={cn('size-5', props.starred && 'fill-current')} />}
                  onClick={run(props.onStar)}
                >
                  {props.starred ? 'Unstar' : 'Star'}
                </Item>
              )}
              {props.onBookmark && (
                <Item icon={<Bookmark className="size-5" />} onClick={run(props.onBookmark)}>
                  Bookmark…
                </Item>
              )}
              {props.onRemind && (
                <Item icon={<AlarmClock className="size-5" />} onClick={run(props.onRemind)}>
                  Remind me
                </Item>
              )}
              {props.canTranslate && (
                <Item icon={<Languages className="size-5" />} onClick={run(props.onTranslate)}>
                  Translate
                </Item>
              )}
              {props.onDescribe && (
                <Item icon={<Languages className="size-5" />} onClick={run(props.onDescribe)}>
                  Explain with Flick
                </Item>
              )}
              {props.canEdit && (
                <Item icon={<Pencil className="size-5" />} onClick={run(props.onEdit)}>
                  Edit
                </Item>
              )}
              {props.onNote && (
                <Item icon={<StickyNote className="size-5" />} onClick={run(props.onNote)}>
                  Add note
                </Item>
              )}
              {props.onEditHistory && (
                <Item icon={<History className="size-5" />} onClick={run(props.onEditHistory)}>
                  Edit history
                </Item>
              )}
              {props.onInfo && (
                <Item icon={<Info className="size-5" />} onClick={run(props.onInfo)}>
                  Message info
                </Item>
              )}
              {!props.isMine && (
                <Item icon={<Flag className="size-5" />} onClick={run(props.onReport)}>
                  Report
                </Item>
              )}
              <Item
                icon={<Trash2 className="size-5" />}
                danger
                onClick={() => {
                  setStep('delete');
                }}
              >
                Delete
              </Item>
            </div>
          </>
        ) : (
          <div role="menu" aria-label="Delete options" className="flex flex-col">
            <p className="px-4 py-2 text-sm font-semibold">Delete message?</p>
            <Item
              onClick={run(() => {
                props.onDelete('me');
              })}
            >
              Delete for me
            </Item>
            {props.isMine && (
              <Item
                danger
                onClick={run(() => {
                  props.onDelete('everyone');
                })}
              >
                Delete for everyone
              </Item>
            )}
            <Item onClick={onClose}>Cancel</Item>
          </div>
        )}
      </div>
    </Modal>
  );
};
