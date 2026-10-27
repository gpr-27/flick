import { useEffect } from 'react';
import { cn } from '@/components/ui';
import { useChatLists } from './useChatLists';

/** Folder tabs and tag chips next to All / Unread / ... Picking the same one again clears it. */
export const ListTabs = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (listId: string | null) => void;
}) => {
  const lists = useChatLists((s) => s.lists);
  const load = useChatLists((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  if (lists.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Folders and tags"
      className="scroll-slim flex gap-1 overflow-x-auto px-3 py-1"
    >
      {lists.map((l) => (
        <button
          key={l.id}
          type="button"
          aria-pressed={value === l.id}
          onClick={() => {
            onChange(value === l.id ? null : l.id);
          }}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
            value === l.id
              ? 'bg-primary text-primary-content'
              : '[@media(hover:hover)]:hover:bg-base-content/5',
          )}
        >
          {l.kind === 'tag' && (
            <span className="size-2 rounded-full" style={{ backgroundColor: l.color ?? '#888' }} />
          )}
          {l.name}
        </button>
      ))}
    </div>
  );
};
