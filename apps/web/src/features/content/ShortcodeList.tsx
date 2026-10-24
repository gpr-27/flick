import { cn } from '@/components/ui';
import { SHORTCODE_LIST_ID, shortcodeOptionId, type Shortcode } from './shortcodes';

/** Emoji suggestions above the composer (an ARIA listbox; the text field keeps the focus). */
export const ShortcodeList = ({
  items,
  active,
  onPick,
}: {
  items: readonly Shortcode[];
  active: number;
  onPick: (item: Shortcode) => void;
}) => (
  <ul
    id={SHORTCODE_LIST_ID}
    role="listbox"
    aria-label="Emoji suggestions"
    className="glass-card absolute bottom-full left-3 z-30 mb-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-base-content/10 p-1 shadow-xl"
  >
    {items.map((item, i) => (
      <li
        key={item.name}
        id={shortcodeOptionId(i)}
        role="option"
        aria-selected={i === active}
        // mousedown, not click: a click would first blur the field.
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(item);
        }}
        className={cn(
          'cursor-pointer rounded-lg px-3 py-1.5 text-sm',
          i === active && 'bg-primary/15',
        )}
      >
        <span className="mr-2 text-lg">{item.emoji}</span>
        <span className="text-base-content/70">:{item.name}:</span>
      </li>
    ))}
  </ul>
);
