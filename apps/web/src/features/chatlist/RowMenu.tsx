// The menu of one chat in the list: every swipe action plus "Select". It is the keyboard and
// screen-reader way to do what a swipe does, and it opens from the "⋮" on hover, a right-click,
// the context-menu key or Shift+F10.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { ConversationSummary } from '@chat/contracts';
import { AnchoredPanel, cn, useFocusTrap } from '@/components/ui';
import { conversationTitle } from '../chat/conversationView';
import { menuActionIds, menuLabel, describeAction, type ActionId } from './rowActions';

const itemClass =
  'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none';

export const RowMenu = ({
  conversation,
  anchor,
  onAction,
  onSelect,
  onClose,
}: {
  conversation: ConversationSummary;
  anchor: RefObject<HTMLElement | null>;
  onAction: (id: ActionId) => void;
  onSelect: () => void;
  onClose: () => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(menuRef, true, { onEscape: onClose });
  // Escape works wherever the focus is: the menu lives in <body>.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const choose = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <AnchoredPanel anchor={anchor} onClose={onClose}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Options for chat with ${conversationTitle(conversation)}`}
        onKeyDown={onKeyDown}
        className="w-56 rounded-xl border border-base-content/15 bg-base-100 p-1 text-base-content shadow-xl"
      >
        {menuActionIds(conversation).map((id) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            onClick={choose(() => {
              onAction(id);
            })}
            className={cn(itemClass, describeAction(id, conversation).destructive && 'text-error')}
          >
            {menuLabel(id, conversation)}
          </button>
        ))}
        {!conversation.is_saved && (
          <button type="button" role="menuitem" onClick={choose(onSelect)} className={itemClass}>
            Select
          </button>
        )}
      </div>
    </AnchoredPanel>
  );
};
