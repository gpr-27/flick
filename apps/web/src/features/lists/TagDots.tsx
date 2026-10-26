import { useChatLists, tagsOf } from './useChatLists';

/** Small coloured dots for a chat's tags, shown next to its name in the list. */
export const TagDots = ({ conversationId }: { conversationId: string }) => {
  const lists = useChatLists((s) => s.lists);
  const tags = tagsOf(lists, conversationId);
  if (tags.length === 0) return null;
  return (
    <span
      className="flex shrink-0 gap-0.5"
      aria-label={`Tags: ${tags.map((t) => t.name).join(', ')}`}
    >
      {tags.map((t) => (
        <span
          key={t.id}
          title={t.name}
          className="size-2 rounded-full"
          style={{ backgroundColor: t.color ?? '#888' }}
        />
      ))}
    </span>
  );
};
