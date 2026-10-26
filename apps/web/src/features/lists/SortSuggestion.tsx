import { useState } from 'react';
import { useChatStore } from '../chat/useChatStore';
import { suggestList } from './sortRules';
import { useChatLists } from './useChatLists';

const dismissed = (id: string): boolean => {
  try {
    return localStorage.getItem(`flick.sortDismissed.${id}`) === '1';
  } catch {
    return false;
  }
};

/** One line in a chat that is in no folder: "Add to Work?" with a one-tap Add. */
export const SortSuggestion = ({ conversationId }: { conversationId: string }) => {
  const conversation = useChatStore((s) => s.conversations[conversationId]);
  const lists = useChatLists((s) => s.lists);
  const toggle = useChatLists((s) => s.toggle);
  const [hidden, setHidden] = useState(() => dismissed(conversationId));
  const suggestion = conversation && !hidden ? suggestList(conversation, lists) : null;
  if (!suggestion) return null;
  const hide = (): void => {
    try {
      localStorage.setItem(`flick.sortDismissed.${conversationId}`, '1');
    } catch {
      // ignore
    }
    setHidden(true);
  };
  return (
    <div className="mb-2 flex items-center gap-2 text-sm text-[var(--text-2)]">
      <span className="min-w-0 flex-1 truncate">Add this chat to {suggestion.name}?</span>
      <button
        type="button"
        className="btn btn-xs min-h-[32px] rounded-full btn-primary"
        onClick={() => {
          void toggle(suggestion, conversationId);
          hide();
        }}
      >
        Add
      </button>
      <button type="button" className="btn btn-xs btn-ghost min-h-[32px]" onClick={hide}>
        No thanks
      </button>
    </div>
  );
};
