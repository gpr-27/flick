import type { UserSummary } from '@chat/contracts';
import { cn } from '@/components/ui';
import { MENTION_LIST_ID, mentionOptionId, splitMentions } from './mentions';

/** Text with mentions highlighted. React escapes everything, so the text is never treated as HTML. */
export const MentionText = ({ text, known }: { text: string; known: ReadonlySet<string> }) => {
  const parts = splitMentions(text, known);
  if (!parts.some((p) => p.mention)) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.mention ? (
          <span
            key={i}
            className="rounded bg-black/15 px-0.5 font-semibold underline decoration-dotted underline-offset-2"
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
};

/** The suggestion list above the composer (an ARIA listbox; the input owns the focus). */
export const MentionList = ({
  items,
  active,
  onPick,
}: {
  items: readonly UserSummary[];
  active: number;
  onPick: (user: UserSummary) => void;
}) => (
  <ul
    id={MENTION_LIST_ID}
    role="listbox"
    aria-label="Mention suggestions"
    className="glass-card absolute bottom-full left-3 z-30 mb-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-base-content/10 p-1 shadow-xl"
  >
    {items.map((u, i) => (
      <li
        key={u.id}
        id={mentionOptionId(i)}
        role="option"
        aria-selected={i === active}
        // mousedown, not click: a click would first blur the input and close the list.
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(u);
        }}
        className={cn(
          'cursor-pointer rounded-lg px-3 py-1.5 text-sm',
          i === active && 'bg-primary/15',
        )}
      >
        <span className="font-semibold">{u.display_name}</span>{' '}
        <span className="text-base-content/60">@{u.username}</span>
      </li>
    ))}
  </ul>
);
